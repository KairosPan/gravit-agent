// face/client/js/render/account.js — Account on the face (spec 2026-10-22 §6.2): the Account's reads through
// the face's proxy, in seven tabs — Portfolio (the two figures, the change for the range and its curve, Assets, Positions,
// Open orders), Money (plan 4b Task 2: Receive, an address per account and network on a press; Move, the move sheet from each
// account money moves from, on a page that signs for an Account that takes writes; the payments waiting for the operator's
// wallet), Venues (each venue with its health and what it does, its Details drawer; the A-share quotes line; the seat
// box), Agents (Gravit's seat first — on a page that signs, while admitted, its Give a limit…, End limit… and Revoke…, and while it
// knocks its Let in… — then the Account's agents and the keys knocking; plan 4b Task 5: the Agent wallets, each with Top up… and
// Take back… through the move sheet, and Open an agent wallet…), Cards (what waits for the owner, and
// the agents' asks), Rules (plan 4a Task 5: the mode with its door-by-door rules, the cap on each move, the agents' session and
// their leverage; Guard one unsigned click, the rest signed, their keys only on a page that signs), Identity (plan B1b: the account's
// identity read, drawn by render/identity.js) — the Statement drawer, the Settings drawer with Devices; the owner device's line under
// the head (render/owner.js), and for a page that signs the keys that open the owner's sheets on Venues, Agents and Cards
// (Connect an account, Open a paper account, Disconnect, Top up, Start over; Let in, Give a limit of every kind, End limit, Revoke,
// Approve, Reject, Grant, Decline) — and, for an Account that takes writes, each position's Close… (Sell…) and a perpetual's
// Leverage… on Portfolio (plan 4a Task 3). Every figure and word is a view's (host/account-view.js);
// this module draws them.
import { esc, attrs, cls } from '../html.js';
import { fmtClock, fmtDate, sameDay } from '../time.js';
import { money, signedMoney, sign } from '../wire/account-model.js';
import { price } from '../wire/market-model.js';
import {
  pageOk, headOf, worthOf, changeOf, assetsOf, positionsOf, openOrdersOf, missingWords, statementLinesOf,
  venuesOf, agentsOf, cardsOf, asksOf, requestsOf, seatWords, writesOn, walletsOf, marketOldOf,
} from '../host/account-view.js';
import { amendSeedOf, closeSeedOf, leverageSeedOf } from '../host/sheet-market.js';
import { rulesOf } from '../host/rules-view.js';
import { receiveRowsOf, receiveNetworkWords, moveSourcesOf, earnListOf, earnRate, earnOutAt } from '../host/money-view.js';
import { SELL_MANY_MAX, smLegName, smLegWords } from '../host/sell-many.js';
import { whatYouSignLines } from '../host/owner-view.js';
import { underWayOf } from '../host/trade-view.js';
import { walletRow } from './wallet-row.js';
import { providerWord } from '../host/market-view.js';
import { chip } from './thread.js';
import { seg, segLinks, sec, confirmPair } from './controls.js';
import { grantsAsk } from '../host/sheet-view.js';
import { curveSvg } from './chart.js';
import { renderDeviceLine, renderDevices } from './owner.js';
import { renderIdentityTab } from './identity.js';
import { HOST_NAME } from '../wire/speaker.js';
import { t, th, tn } from '../i18n/words.js';

// the seven tabs, each its id and its word
const tabsOf = () => [['portfolio', t('account.tab.portfolio')], ['money', t('account.tab.money')], ['venues', t('account.tab.venues')], ['agents', t('account.tab.agents')],
  ['cards', t('account.tab.cards')], ['rules', t('account.tab.rules')], ['identity', t('account.tab.identity')]];
// the curve's ranges, the Account's own names and their words
const rangesOf = () => [['1d', t('account.range.day')], ['1w', t('account.range.week')], ['1m', t('account.range.month')], ['all', t('account.range.all')]];
// a venue's Details facts, each under its label
const detailsOf = () => [['noTradeBecause', t('venues.detail.noTrade')], ['restricted', t('venues.detail.restricted')], ['notServed', t('venues.detail.notServed')],
  ['closeOnly', t('venues.detail.closeOnly')], ['watchOnly', t('venues.detail.watchOnly')], ['keyFile', t('venues.detail.keyFile')]];

const box = (inner, label) => `<section class="cardbox"${label ? ` aria-label="${label}"` : ''}>${inner}</section>`;
const note = text => `<p class="acct-note">${esc(text)}</p>`;
const title = text => `<div class="cardbox-title">${esc(text)}</div>`;
const tone = value => ({ pos: 'up', neg: 'down' })[sign(value)] ?? 'flat';
const retry = () => `<button type="button" class="btn-sm" data-action="refreshAccount">${th('account.retry')}</button>`;
// a quantity or a price as the Account gives it, grouped (0.707, 63,226.6); nothing given is —
const numWord = n => (n === null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 }));
// the Account's percents are percents already (0.72 is 0.72 %), never a fraction to scale; nothing given is —
const pctWord = v => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(2)} %`);
const capital = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const when = (at, now) => { const ms = Date.parse(at); return Number.isNaN(ms) ? '' : sameDay(ms, now) ? fmtClock(ms) : `${fmtDate(ms)} ${fmtClock(ms)}`; };
const dateWord = at => { const ms = Date.parse(at); return Number.isNaN(ms) ? '' : fmtDate(ms); };
// a row's words: the first bold (a chip beside it), each line under it dim, blanks left out
const lines = (head, dims = [], chipText = '') => `<b>${esc(head)}</b>${chipText ? ` ${chip(chipText)}` : ''}${dims.filter(Boolean).map(d => `<br><span class="dim">${esc(d)}</span>`).join('')}`;
// a table: its head, then each row's cells as HTML, every column but the first a figure, right-aligned
const table = (head, rows) => `<div class="acct-wrap"><table class="acct-t"><thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>` +
  `<tbody>${rows.map(cells => `<tr>${cells.map((c, i) => `<td${i ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
// a read beside the page, in a word where its rows would be: not read yet, failed before any answer, or read and empty
const readNote = (read, failed, none) => note(read.data === null ? (read.status === 'error' ? failed : t('common.loading')) : none);

// the page's state where its figures would be: still loading, unavailable (with Retry), or an answer the face does not
// recognise — never a number from it; null when the page is the Account's
function pageNote(a) {
  if (pageOk(a.data)) return null;
  if (a.data) return note(t('account.unreadable'));
  return a.status === 'error' ? `${note(t('account.unavailable'))}<div class="btn-row">${retry()}</div>` : note(t('common.loading'));
}

function head(state) {
  const h = headOf(state.account.data);
  return `<div class="acct-head"><h1 class="head-title">${th('account.title')}</h1>${h.mode ? chip(h.mode) : ''}${h.writes ? chip(h.writes) : ''}<span class="spacer"></span>` +
    `<button type="button" class="pill" data-action="refreshAccount">${th('account.refresh')}</button><button type="button" class="pill" data-action="openSettings">${th('account.settings')}</button></div>` +
    renderDeviceLine(state);
}

// the tabs, the Cards tab counting what waits
function tabs(state, tab) {
  const waiting = cardsOf(state.account.data).reduce((n, g) => n + g.cards.length, 0);
  return segLinks(tabsOf().map(([id, label]) => [id === 'cards' && waiting ? t('account.tab.cardsWaiting', { n: waiting }) : label, `#/account/${id}`, id]), tab);
}

// ── Portfolio ──

// the change for the range in one run: the change (— when the Account gave none), the curve's own range word (a read for a
// range the screen has since left says so), partial when the Account says it is, since when for All; and on the paper curve,
// what the paper book made since its start and whether the Account rebuilt it from the book
function changeLine(a, paperLeads) {
  const c = changeOf(a.history.data);
  const ranges = rangesOf();
  const range = ranges.find(([id]) => id === a.history.data?.range) ?? ranges.find(([id]) => id === a.history.range);
  const since = range?.[0] === 'all' && c.first ? dateWord(c.first) : '';
  const words = [
    c.usd === null ? '—' : `${signedMoney(c.usd)} · ${pctWord(c.pct)}`, range?.[1], c.partial ? t('account.change.partial') : '', since ? t('account.change.since', { date: since }) : '',
    paperLeads && c.sinceStartUsd !== null ? t('account.change.sinceStart', { usd: signedMoney(c.sinceStartUsd) }) : '', paperLeads && c.rebuilt ? t('account.change.rebuilt') : '',
  ].filter(Boolean).join(' · ');
  return `<div class="delta"><span class="${tone(c.usd)}">${esc(words)}</span></div>`;
}

// Assets and Positions are the leading lens's read: the paper book's (holdings?cost=1&paper=1) while Paper leads, else real
// money's (holdings?cost=1). When that read refused, the Account's sentence: where Holdings unavailable would be before any
// answer (the fixed word only when there is none), over the rows kept after one
// on a page that signs, for an Account that takes writes, an Earning row's Take out… (the Earn sheet on Take out, the product
// the row is in — the one it names, else its venue's), and the Assets' Sell many… (plan 4b Task 3; portfolio.js:634, :675)
function earnOutKey(r, state) {
  if (r.cls !== 'earn' || !marketKeysOn(state)) return '';
  const page = state.account.data;
  const at = r.earn && earnOutAt(page, r.earn.venue) ? { venue: r.earn.venue, product: r.earn.product } : (v => (v ? { venue: v.venue, product: v.product } : null))(r.venues.find(v => earnOutAt(page, v.venue)));
  return at ? `<br>${sheetKey('earn', { 'data-venue': at.venue, 'data-side': 'withdraw', 'data-product': at.product }, t('money.earn.takeOut'))}` : '';
}

function assetsBox(lens, state) {
  const rows = assetsOf(lens.data).map(r => [
    lines(r.asset, r.venues.map(v => [v.venueName || v.venue, numWord(v.amount), v.stale ? t('account.venue.stale') : ''].filter(Boolean).join(' · '))) + earnOutKey(r, state),
    esc(numWord(r.amount)), esc(price(r.price)), `<span class="${tone(r.changePct24h)}">${esc(pctWord(r.changePct24h))}</span>`, esc(money(r.usd)),
  ]);
  const said = lens.status === 'error' && lens.message ? note(lens.message) : '';
  const head = [t('account.assets.asset'), t('account.assets.amount'), t('account.assets.price'), t('account.assets.day'), t('account.assets.value')];
  const body = rows.length ? table(head, rows) : said && lens.data === null ? '' : readNote(lens, t('account.assets.unavailable'), t('account.assets.none'));
  const tools = marketKeysOn(state) ? `<div class="btn-row"><button type="button" class="btn-sm" data-action="openSellMany">${th('account.assets.sellMany')}</button></div>` : '';
  return box(`${title(t('account.assets.title'))}${tools}${said}${body}`, th('account.assets.title'));
}

// the Positions table; on a page that signs, for an Account that takes writes, each row's Close… (Sell…) and a perpetual's
// Leverage… where its venue sets it
function positionsBox(lens, state) {
  const keyed = marketKeysOn(state);
  const rows = positionsOf(lens.data).map(p => [
    lines(p.symbol, [[p.venueName || p.venue, p.side, numWord(p.qty)].filter(Boolean).join(' · ')], p.paper ? t('account.chip.paper') : ''),
    esc(money(p.usd)), esc(price(p.entryPrice)), esc(price(p.markPrice)), `<span class="${tone(p.unrealizedUsd)}">${esc(signedMoney(p.unrealizedUsd))}</span>`,
    ...(keyed ? [rowKeys(positionKeys(p, state.account.data, state.markets?.accountQuotes))] : []),
  ]);
  const pnl = 'P&L'; // en-kept: an abbreviation the table cannot hold (an ampersand before a letter)
  const head = [t('account.positions.position'), t('account.positions.value'), t('account.positions.entry'), t('account.positions.mark'), pnl, ...(keyed ? [''] : [])];
  return rows.length ? box(`${title(t('account.positions.title'))}${table(head, rows)}`, th('account.positions.title')) : '';
}

// an order in a line: `Stand-in Exchange · Buy 0.5 SOL/USDT · limit 142.44 · open · You` (a market's page lists its own so)
export function orderWords(o) {
  const type = o.type.replace(/_/g, ' ');
  const size = [capital(o.side), o.qty === null ? '' : numWord(o.qty), o.symbol].filter(Boolean).join(' ');
  return [o.venueName || o.venue, size, type && o.limitPrice !== null ? `${type} ${numWord(o.limitPrice)}` : type, o.status, o.who].filter(Boolean).join(' · ');
}

function ordersBox(a) {
  const open = openOrdersOf(a.data).map(o => `<div class="order-row">${esc(orderWords(o))}</div>`).join('');
  return box(`${title(t('account.orders.title'))}${open ? `<div class="acct-orders">${open}</div>` : note(t('account.orders.none'))}`, th('account.orders.title'));
}

function portfolio(state, now) {
  const a = state.account;
  const unread = pageNote(a);
  if (unread !== null) return unread;
  const w = worthOf(a.data, a.holdings.data, a.paper.data);
  const figure = (f, size) => `<div><div class="label">${esc(f.label)}</div><div class="${size}">${esc(money(f.usd))}</div></div>`;
  const figures = `<div class="acct-figures">${figure(w.lead, 'networth')}${w.second ? figure(w.second, 'acct-second') : ''}</div>`;
  // the market service not answering: the prices under the worth are the last it gave, said once under the figures
  const old = marketOldOf(a.holdings.data) ?? marketOldOf(a.paper.data);
  const oldLine = old ? note(t('account.pricesOld', { message: old.message, since: fmtClock(Date.parse(old.since)) })) : '';
  // the venues a read could not reach, the paper lens's with them, each once
  const gone = [...new Set([...missingWords(a.holdings.data?.missing), ...missingWords(a.paper.data?.missing)])];
  // a page the Account says is stale, or a read that failed after a good one: the last good figures, stamped with the page's time
  const failed = a.status === 'error';
  const stale = failed || a.data.stale === true ? note(t('account.asOfStale', { when: when(a.data.now, now) || t('account.earlier') })) : '';
  const worth = box(`${figures}${oldLine}${changeLine(a, w.paperLeads)}${seg(rangesOf().map(([id, word]) => [word, id]), a.history.range, 'setHistoryRange')}` +
    `${curveSvg(a.history.data?.points, { currency: 'USD', label: w.lead.label })}${gone.length ? note(gone.join(' · ')) : ''}${stale}` +
    `<div class="btn-row">${failed ? retry() : ''}<button type="button" class="btn-sm" data-action="openStatement">${th('account.statement.title')}</button></div>`, th('account.tab.portfolio'));
  const lens = w.paperLeads ? a.paper : a.holdings;
  return `<div class="cards">${worth}${assetsBox(lens, state)}${positionsBox(lens, state)}${ordersBox(a)}</div>`;
}

// ── Venues ──

// a venue's Disconnect…, for a page that signs — asked twice, the confirm for this venue in its place. An agent wallet has
// none: the Account never disconnects one.
function disconnectKey(v, state) {
  if (!signs(state) || !v.id || v.connector === 'live:agent-wallet') return '';
  const c = state.confirm;
  return c?.action === 'disconnect' && c.venue === v.id ? confirmPair(t('venues.disconnectYes'))
    : `<button${attrs({ type: 'button', class: 'btn-danger', 'data-action': 'askDisconnect', 'data-venue': v.id, 'data-name': v.name })}>${th('venues.disconnect')}</button>`;
}

// a connected venue's switch to agents (plan 4b Task 4; portfolio.js pfAgentsSwitch): one closed to them, its Reopen… on a page
// that signs (widening what agents may do is signed); any other, its Close to agents on any page that reads the Account (free,
// the safer direction), off while its press is in the air. A paper venue has neither.
function agentsKey(v, state) {
  if (v.paper || !v.id) return '';
  if (v.closedToAgents) return signs(state) ? sheetKey('reopen', { 'data-venue': v.id, 'data-name': v.name || v.id }, t('venues.reopen')) : '';
  const busy = state.account.closing?.[v.id]?.status === 'asking';
  return `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': 'closeToAgents', 'data-venue': v.id, disabled: busy })}>${th('venues.closeToAgents')}</button>`;
}

function venueRow(v, now, state) {
  const since = v.health === 'not-answering' ? when(v.since, now) : '';
  const health = since ? t('venues.health.since', { health: v.healthWords, since }) : v.healthWords;
  const stale = v.stale === true ? t('account.venue.stale') : typeof v.stale === 'string' ? v.stale : '';
  const facts = [v.usd === null ? '' : money(v.usd), v.frontLine, v.what].filter(Boolean).join(' · ');
  return `<div class="venue"><span>${lines(v.name || v.id, [facts, [health, ...v.does, stale].filter(Boolean).join(' · ')], v.paper ? t('account.chip.paper') : v.closedToAgents ? t('venues.closedChip') : '')}</span>` +
    `<button type="button" class="btn-sm" data-action="openVenueDetails"${attrs({ 'data-id': v.id })}>${th('venues.details')}</button>${agentsKey(v, state)}${disconnectKey(v, state)}</div>`;
}

// a venue's Details: what it holds there and the Account's facts about it, each under its label — the key file by its path,
// never what is in it; for a page that signs, a paper venue's Top up and Start over
function venueDetails(v, state) {
  const d = v.details;
  const held = d.holdings.map(h => [h.asset, numWord(h.amount), money(h.usd)].filter(Boolean).join(' · '));
  const body = (held.length ? sec(t('venues.holdings'), held) : '') + detailsOf().filter(([key]) => d[key]).map(([key, label]) => sec(label, [d[key]])).join('');
  const named = { 'data-venue': v.id, 'data-name': v.name };
  const keys = signs(state) && v.paper && v.id ? `<div class="btn-row">${sheetKey('topUp', named, t('venues.topUp'))}${sheetKey('resetPaper', named, t('venues.startOver'))}</div>` : '';
  return `<aside class="drawer" aria-label="${th('venues.detailsLabel')}"><div class="drawer-head"><h2>${esc(v.name || v.id)}</h2><button type="button" class="close-key" data-action="closeVenueDetails" aria-label="${th('common.close')}">×</button></div>` +
    `<div class="drawer-body">${body || note(t('venues.noDetails'))}${keys}</div></aside>`;
}

function venues(state, now) {
  const a = state.account;
  const rows = venuesOf(a.data).map(v => venueRow(v, now, state)).join('');
  // for a page that signs, the page's own sheets: what to connect comes from its connectLive, so an unread page has none
  const keys = signs(state) && pageOk(a.data) ? `<div class="btn-row">${sheetKey('connect', {}, t('venues.connect'))}${sheetKey('paper', {}, t('venues.openPaper'))}</div>` : '';
  // what the last Close to agents said, each venue's: the face's sentence, or the Account's refusal
  const closings = pageOk(a.data) ? Object.values(a.closing ?? {}).map(c => c?.said || c?.message).filter(Boolean).map(note).join('') : '';
  const list = (pageNote(a) ?? (rows ? `<div class="venues">${rows}</div>` : note(t('venues.none')))) + closings + keys;
  // the A-share quotes' provider, as the Account's China status names it: the Account's own sentence where it says one, else its word
  const cn = (Array.isArray(state.markets?.providers) ? state.markets.providers : []).filter(p => p?.market === 'cn');
  const said = p => (typeof p.said === 'string' && p.said.trim() ? p.said : providerWord(p));
  const quotes = cn.length ? `<div class="label">${th('venues.aShares')}</div><div class="venues">${cn.map(p => `<div class="venue"><span>${esc(said(p))}</span></div>`).join('')}</div>` : '';
  return `<div class="cards">${box(`${title(t('account.tab.venues'))}${list}${quotes}`, th('account.tab.venues'))}${seatBox(state, now)}</div>`;
}

// the Account seat's standing (spec 2026-10-20 §6.3): the service with the Account's own mode and writes, the seat and its
// limits, the venues with the paper ones marked, the cards waiting — answered on the face's own Cards tab, the way there drawn
// while any wait (spec §5.8: no key leads off the face). Its words are the Account's; the stamp is when the face
// answered.
function seatBox(state, now) {
  const s = state.seat;
  const w = seatWords(s.data);
  const row = (title, dims = [], chipText = '') => `<div class="venue"><span><b>${esc(title)}</b>${chipText ? ` ${chip(chipText)}` : ''}` +
    `${dims.filter(Boolean).map(d => `<br><span class="dim">${esc(d)}</span>`).join('')}</span></div>`;
  let body;
  if (!s.data) body = note(s.status === 'error' ? t('venues.seat.unavailable') : t('common.loading'));
  else if (!w.service) body = note(t('venues.seat.unavailable'));
  else {
    const rows = [row(w.service, [[w.mode, w.writes].filter(Boolean).join(' · ')])];
    if (w.seat) rows.push(row(w.seat, w.limits));
    for (const v of w.venues) rows.push(row(v.name, [[v.usd, v.note].filter(Boolean).join(' · ')], v.paper ? t('account.chip.paper') : ''));
    // the view's own stamp — when the seat route answered, the Account's read it reduced kept up to 15 s by the proxy's reader —
    // else, for an unreachable answer, which carries none, when this page's read landed
    const read = typeof s.at === 'number' ? new Date(s.at).toISOString() : undefined;
    const at = when(s.data.asOf ?? read, now) || t('account.earlier');
    const stamp = s.status === 'error' ? t('account.asOfStale', { when: at }) : t('account.asOf', { when: at });
    body = `<div class="venues">${rows.join('')}</div>${note([w.cards, stamp].filter(Boolean).join(' · '))}`;
  }
  const keys = `<div class="btn-row"><button type="button" class="btn-sm" data-action="refreshAccount">${th('account.refresh')}</button>` +
    `${w.cards ? `<a class="btn-sm" href="#/account/cards">${th('venues.seat.answer')}</a>` : ''}</div>`;
  return box(`<div class="cardbox-title">${th('venues.seat.title')}</div>${body}${keys}`, th('venues.seat.title'));
}

// ── Agents ──

// the cards an agent has waiting and its open orders; a count the Account has not given (its agents not read) is —
const countsOf = r => t('agents.counts', { cards: r.cards === null ? '—' : r.cards, orders: r.orders === null ? '—' : r.orders });

// ── the owner's keys (plan 2 Task 7) ──
// Drawn only for a page that signs (absent otherwise: the device line under the head says why). Each opens its sheet with the
// parts of the seed the store cannot tell, every one escaped by attrs; the handler builds the rest from the store.
const signs = state => state.owner?.role === 'signs';
const sheetKey = (kind, data, word, klass = 'btn-sm') => `<button${attrs({ type: 'button', class: klass, 'data-action': 'openSheet', 'data-kind': kind, ...data })}>${esc(word)}</button>`;
const rowKeys = keys => (keys.length ? `<span class="btn-row">${keys.join('')}</span>` : '');

// ── the Market half's keys (plan 4a Task 3): Close…, Change… and Leverage… ──
// Drawn only for a page that signs and an Account that takes writes (its page's connectLive.writes.on), wherever a working
// order or a position is: Trade's Under way, a market's page, the Portfolio. Each carries its sheet's seed as data-* — the
// market's kind as data-market-kind, data-kind being the sheet's — and app.js's openSheetFrom reads it back as the strings drawn.
export const marketKeysOn = state => signs(state) && writesOn(state.account?.data);
const SEED_ATTRS = {
  venue: 'data-venue', venueName: 'data-venue-name', symbol: 'data-symbol', name: 'data-name', side: 'data-side', qty: 'data-qty',
  kind: 'data-market-kind', order: 'data-order', type: 'data-type', limitPrice: 'data-limit-price', stopPrice: 'data-stop-price',
  base: 'data-base', leverage: 'data-leverage', maxLeverage: 'data-max-leverage', marginModes: 'data-margin-modes',
};
const seedAttrs = seed => Object.fromEntries(Object.entries(seed).filter(([k]) => Object.hasOwn(SEED_ATTRS, k)).map(([k, v]) => [SEED_ATTRS[k], String(v)]));
/** The key that opens a Market sheet on its seed. */
export const marketKey = (kind, seed, word, klass = 'btn-sm') => sheetKey(kind, seedAttrs(seed), word, klass);
/** A working order's Change…, where its venue changes it in place and its type rests; else ''. */
export function changeKey(order, page) {
  const seed = amendSeedOf(order, page);
  return seed ? marketKey('amend', seed, t('account.key.change')) : '';
}
/** A position's keys: Close… (Sell… for a stock or an event), and Leverage… on a perpetual whose venue sets it. */
export function positionKeys(position, page, quotes = null) {
  const close = closeSeedOf(position);
  const lev = leverageSeedOf(position, page, quotes);
  const sells = close && (close.kind === 'stock' || close.kind === 'event');
  return [close ? marketKey('close', close, sells ? t('account.key.sell') : t('account.key.close')) : '', lev ? marketKey('leverage', lev, t('account.key.leverage')) : ''].filter(Boolean);
}

// the kinds of limit the face ends (host/sheet-view.js LIMIT_SCOPES)
const SCOPES = new Set(['trade', 'venues', 'payees', 'earn']);
// agents-mount.js:228 — what revoking a key does, asked before its sheet; Gravit's seat revoked stops Gravit's orders too
const revokeWords = r => (r.gravit ? t('agents.revoke.seat', { name: r.name }) : t('agents.revoke.agent', { name: r.name }));

// an agent's keys, by its address: Give a limit…, End limit… on each limit standing by its scope (its ids comma-joined, never *
// but a payees limit's any payee), Revoke… — asked twice, the Account's words and the confirm for this agent in its place.
// Gravit's own row has them while its seat is admitted (by the seat view's address and the seat's name) and, while it knocks,
// Let in… on the one request at the seat view's address (never one bound by name alone); any other standing, none.
function agentKeys(r, state) {
  if (r.gravit && r.seatStatus !== 'admitted') {
    return r.seatStatus === 'knocking' && r.request ? rowKeys([sheetKey('letIn', { 'data-address': r.request.address, 'data-name': r.request.name || r.name }, t('agents.letIn'))]) : '';
  }
  const keys = [];
  if (r.address) {
    keys.push(sheetKey('limit', { 'data-address': r.address, 'data-name': r.name }, t('agents.giveLimit')));
    for (const l of r.limits) {
      const allow = l.scope === 'payees' ? l.allow : l.allow.filter(id => id !== '*');
      if (SCOPES.has(l.scope) && !l.expired && allow.length) keys.push(sheetKey('endLimit', { 'data-address': r.address, 'data-name': r.name, 'data-scope': l.scope, 'data-allow': allow.join(',') }, t('agents.endLimit')));
    }
  }
  if (r.name) {
    const c = state.confirm;
    keys.push(c?.action === 'revoke' && c.name === r.name && (c.address ?? '') === r.address ? `<span class="dim">${esc(revokeWords(r))}</span>${confirmPair(t('agents.revokeYes'))}`
      : `<button${attrs({ type: 'button', class: 'btn-danger', 'data-action': 'askRevoke', 'data-address': r.address, 'data-name': r.name })}>${th('agents.revoke.key')}</button>`);
  }
  return rowKeys(keys);
}

// an agent wallet (money.js renderWallets, :371-385): its name, whom it pays for, its address, what it holds of how much it keeps
// at most; on a page that signs for an Account that takes writes, Top up… (the move sheet to it, from the only account money
// moves from that is not an agent wallet — or the first of them, the From select picking another) and Take back… (the move
// sheet from it), each while the page offers it
function agentWalletRow(w, sources, keys) {
  const usd = n => (n === null ? '—' : money(n));
  const words = [t('agents.wallet.paysFor', { who: w.agentName || w.agent || t('agents.wallet.anAgent') }), w.address, t('agents.wallet.holds', { held: usd(w.balanceUsd), cap: usd(w.capUsd) })].join(' · ');
  const out = [];
  if (keys) {
    const from = sources.find(x => !x.agent);
    if (from) out.push(sheetKey('move', { 'data-from': from.id, 'data-to': w.venue }, t('agents.wallet.topUp')));
    if (sources.some(x => x.id === w.venue)) out.push(sheetKey('move', { 'data-from': w.venue }, t('agents.wallet.takeBack')));
  }
  return `<div class="venue"><span>${lines(w.name, [words])}</span>${rowKeys(out)}</div>`;
}

// the Agent wallets (plan 4b Task 5): a row a wallet, and Open an agent wallet… while a key is let in to pay for
function walletsBox(state) {
  const a = state.account;
  if (!pageOk(a.data)) return '';
  const keys = signs(state) && writesOn(a.data);
  const sources = moveSourcesOf(a.data);
  const rows = walletsOf(a.data).map(w => agentWalletRow(w, sources, keys)).join('');
  const standing = (Array.isArray(a.data.keys) ? a.data.keys : []).some(k => k?.status === 'ok' && typeof k.address === 'string' && k.address);
  const none = standing ? t('agents.wallet.none') : t('agents.wallet.letInFirst');
  const open = keys && standing ? `<div class="btn-row">${sheetKey('subWallet', {}, t('agents.wallet.open'))}</div>` : '';
  return box(`${title(t('agents.wallet.title'))}${rows ? `<div class="venues">${rows}</div>` : note(none)}${open}`, th('agents.wallet.title'));
}

function agentsTab(state, now) {
  const a = state.account;
  const owner = signs(state);
  const all = agentsOf(a.agents.data, state.seat.data, a.data);
  const rows = all.map(r => {
    const limits = r.limits.map(l => l.words);
    return `<div class="venue"><span>${r.gravit
      ? lines(r.standing, [...limits, countsOf(r)])
      : lines(r.name || t('agents.who.unnamed'), [[r.status, dateWord(r.validUntil) ? t('agents.until', { date: dateWord(r.validUntil) }) : ''].filter(Boolean).join(' · '), ...limits, countsOf(r)])}</span>` +
      `${owner ? agentKeys(r, state) : ''}</div>`;
  }).join('');
  const status = a.agents.data === null ? note(a.agents.status === 'error' ? t('agents.unavailable') : t('common.loading')) : rows ? '' : note(t('agents.none'));
  // the seat's own knock, bound by its address on Gravit's row, is let in there: listed once; any other request keeps its own
  const seatKnock = all.find(r => r.gravit)?.request?.address ?? '';
  const knocking = requestsOf(a.data).filter(q => !seatKnock || q.address.toLowerCase() !== seatKnock.toLowerCase())
    .map(q => `<div class="venue"><span>${lines(q.name || t('agents.who.unnamed'), [[q.address, when(q.at, now)].filter(Boolean).join(' · ')])}</span>` +
    `${owner ? rowKeys([sheetKey('letIn', { 'data-address': q.address, 'data-name': q.name }, t('agents.letIn'))]) : ''}</div>`).join('');
  return `<div class="cards">${box(`${title(t('account.tab.agents'))}${rows ? `<div class="venues">${rows}</div>` : ''}${status}` +
    `${knocking ? `<div class="label">${th('agents.knocking')}</div><div class="venues">${knocking}</div>` : ''}`, th('account.tab.agents'))}${walletsBox(state)}</div>`;
}

// ── Cards ──

/** A card's value and the time to answer by (`$119.99 · answer by 08:05`), each left out when the Account gave none — the
 *  Cards tab's words, which Trade's Under way reads too. */
export function cardFactsOf(c, now) {
  const by = when(c.expiresAt, now);
  return [c.usd === null ? '' : money(c.usd), by ? t('cards.answerBy', { by }) : ''].filter(Boolean).join(' · ');
}

// a card: why the agent asks, its value and the time to answer by, and What it asks — every field the owner signs, as the
// Account sends it; for a page that signs, ✓ Approve and ✗ Reject, each with the card's id and the hash its answer signs
function cardRow(c, now, owner) {
  const shown = c.shown.map(f => `<div class="dsec-line">${esc(`${f.name}: ${f.value}`)}</div>`).join('');
  const answer = decision => ({ 'data-card': c.id, 'data-hash': c.hash, 'data-decision': decision });
  const keys = owner && c.id && c.hash ? rowKeys([sheetKey('approveCard', answer('approve'), t('cards.approve')), sheetKey('approveCard', answer('reject'), t('cards.reject'))]) : '';
  return `<div class="venue"><div>${lines(c.reason, [cardFactsOf(c, now)])}` +
    `${shown ? `<details${attrs({ id: `shown-${c.id}`, class: 'acct-shown' })}><summary>${th('cards.whatItAsks')}</summary>${shown}</details>` : ''}</div>${keys}</div>`;
}

// an ask in its words; for a page that signs, Grant where this face grants it (grantsAsk, as the retired page's pfGrantable:
// a limit, a venue, a key, a top-up, a session, leverage, the mode — each its sheet, host/sheet-view.js grantOf; a venue not
// on the page once where the account can connect is read) and Decline; under the asks, a Grant that could not open, in words
function askRow(k, page, owner) {
  const words = esc([k.agentName, k.text, k.kind].filter(Boolean).join(' · '));
  if (!owner || !k.id) return `<div class="order-row">${words}</div>`;
  const grant = grantsAsk(k, page) ? `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': 'grant', 'data-ask': k.id })}>${th('cards.grant')}</button>` : '';
  return `<div class="order-row"><span>${words}</span><span class="spacer"></span>${rowKeys([grant, sheetKey('declineAsk', { 'data-ask': k.id }, t('cards.decline'))].filter(Boolean))}</div>`;
}

function cardsTab(state, now) {
  const a = state.account;
  const unread = pageNote(a);
  if (unread !== null) return unread;
  const owner = signs(state);
  const groups = cardsOf(a.data).map(g => `<div class="dsec-label">${esc(g.agentName)}</div><div class="venues">${g.cards.map(c => cardRow(c, now, owner)).join('')}</div>`).join('');
  const asks = asksOf(a.data).map(k => askRow(k, a.data, owner)).join('');
  return `<div class="cards">${box(`${title(t('cards.waiting'))}${groups || note(t('cards.none'))}`, th('account.tab.cards'))}` +
    `${asks ? box(`${title(t('cards.asks'))}<div class="acct-orders">${asks}</div>${typeof a.grantSaid === 'string' && a.grantSaid ? note(a.grantSaid) : ''}`, th('cards.asks')) : ''}</div>`;
}

// ── Rules (plan 4a Task 5) ──

const rulesLead = () => t('rules.lead');
// Beast lifts the Account's card alone: this face's own gate on Gravit's orders (face/src/orders.ts) stands in both modes
const gate2 = () => t('rules.gate2', { name: HOST_NAME });
const usd = n => (n === null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const ruleRow = (head, words, key = '') => `<div class="venue"><span>${lines(head, [words])}</span>${key}</div>`;

// the switch: Guard one click on any page that reads the Account (in Guard too: the Account takes it again); Beast a signed
// sheet, its key only on a page that signs and only while Beast is not in force — pressed, it then does nothing, as on the
// retired page (a signature that changes nothing is never asked)
function modeSeg(mode, owner) {
  const item = (label, value, data) => `<button${attrs({ type: 'button', class: cls('seg-item', mode === value && 'pressed'), 'aria-pressed': mode === value ? 'true' : 'false', ...data })}>${label}</button>`;
  return `<div class="seg">${item(th('account.mode.guard'), 'guard', { 'data-action': 'setGuard' })}${item(th('account.mode.beast'), 'open', !owner ? { disabled: true } : mode === 'open' ? {} : { 'data-action': 'openSheet', 'data-kind': 'beast' })}</div>`;
}

// what each mode does, door by door, as the Account has it; the mode in force marked Now
function modeTable(r) {
  if (!r.modeRows.length) return note(t('rules.noModeRows'));
  const colHead = (label, m) => `<th scope="col">${label}${r.mode === m ? ` ${chip(t('rules.now'))}` : ''}</th>`;
  return `<div class="acct-wrap"><table class="acct-t"><thead><tr><th scope="col">${th('rules.door')}</th>${colHead(th('account.mode.guard'), 'guard')}${colHead(th('account.mode.beast'), 'open')}</tr></thead>` +
    `<tbody>${r.modeRows.map(row => `<tr><td>${esc(row.door)}</td><td>${esc(row.guard)}</td><td>${esc(row.beast)}</td></tr>`).join('')}</tbody></table></div>`;
}

function rulesTab(state, now) {
  const a = state.account;
  const unread = pageNote(a);
  if (unread !== null) return unread;
  const r = rulesOf(a.data, now);
  const owner = signs(state);
  const g = a.guard ?? {};
  // what the last Guard press said, only while it still reads true: done while the page is in Guard, a refusal while it is not
  const said = g.status === 'said' && g.said && r.mode === 'guard' ? note(g.said) : g.status === 'refused' && g.message && r.mode !== 'guard' ? note(g.message) : '';
  const card = r.cardMinutes === null ? '' : note(tn('rules.cardExpires', r.cardMinutes));
  const mode = box(`${title(t('rules.mode'))}${modeSeg(r.mode, owner)}${said}${owner ? '' : note(t('rules.beastSigns'))}` +
    `${note(rulesLead())}${note(gate2())}${modeTable(r)}${card}`, th('rules.mode'));
  const key = (kind, word) => (owner ? `<span class="btn-row">${sheetKey(kind, {}, word)}</span>` : '');
  const cap = r.writes
    ? ruleRow(t('rules.cap.head'), t('rules.cap.words', { usd: usd(r.cap?.usd ?? null) }), key('cap', t('account.key.change')))
    : ruleRow(t('rules.cap.head'), t('rules.cap.readOnly'));
  let session = '';
  if (!r.writes) session = ruleRow(t('rules.session.head'), t('rules.session.readOnly'));
  else if (r.session) {
    const until = Date.parse(r.session.until);
    const words = r.session.ended ? t('rules.session.ended') : t('rules.session.until', { date: Number.isNaN(until) ? '—' : fmtDate(until) });
    session = ruleRow(t('rules.session.head'), words, key('session', r.session.ended ? t('rules.session.start') : t('rules.session.renew')));
  }
  let leverage = '';
  if (r.leverageOffered && !r.writes) leverage = ruleRow(t('rules.leverage.head'), t('rules.leverage.readOnly'));
  else if (r.leverageOffered && r.leverage) leverage = ruleRow(t('rules.leverage.head'), t('rules.leverage.words', { max: r.leverage.max }), key('leverageCap', t('account.key.change')));
  return `<div class="cards">${mode}${box(`<div class="venues">${cap}${session}${leverage}</div>`, th('rules.limits'))}</div>`;
}

// ── Money (plan 4b Task 2) ──

const noReceive = () => t('money.receive.none');
const noSource = () => t('money.move.none');
const moveReadOnly = () => t('money.move.readOnly');
const capFirst = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// a Receive row: the account and its network words (an exchange's asset chip beside them), Show address, and once read, the
// address, its memo where there is one (needed with it, with its own Copy), whose it is with the Account's note, Copy and Read
// again — or the Account's refusal in its words. An address is drawn only from an answer that landed and is not being read again
function receiveRow(row, receive) {
  const key = `${row.venue}|${row.asset}|${row.network}`;
  const read = receive && Object.hasOwn(receive, key) ? receive[key] : null;
  const head = `<b>${esc(`${row.venueName} · ${receiveNetworkWords(row)}`)}</b>${row.chip ? ` ${chip(row.asset)}` : ''}`;
  const asking = read?.status === 'loading';
  const ask = word => `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': 'showAddress', 'data-venue': row.venue, 'data-asset': row.asset, 'data-network': row.network, disabled: asking })}>${word}</button>`;
  const copy = text => `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': 'copyText', 'data-text': text })}>${th('money.receive.copy')}</button>`;
  if (read?.status === 'ready' && read.data) {
    const d = read.data;
    const address = String(d.address ?? '');
    const whose = [capFirst(typeof d.whose === 'string' ? d.whose : ''), typeof d.note === 'string' ? d.note : ''].filter(Boolean).join(' · ');
    const tag = typeof d.tag === 'string' && d.tag ? d.tag : '';
    const memo = tag ? `<br><span class="dim">${th('money.receive.memo')}</span> <span class="mono">${esc(tag)}</span> ${copy(tag)}` : '';
    return `<div class="venue"><span>${head}<br><span class="mono">${esc(address)}</span>${memo}${whose ? `<br><span class="dim">${esc(`${whose}.`)}</span>` : ''}</span>` +
      `<span class="btn-row">${copy(address)}${ask(th('money.receive.again'))}</span></div>`;
  }
  let body = '';
  if (asking) body = `<br><span class="dim">${esc(t('money.receive.asking', { venue: row.venueName }))}</span>`;
  else if (read?.status === 'error') body = `<br><span class="dim">${esc(read.message || t('money.receive.noAnswer'))}</span>`;
  return `<div class="venue"><span>${head}${body}</span><span class="btn-row">${ask(read?.status === 'error' ? th('money.receive.again') : th('money.receive.show'))}</span></div>`;
}

// a source of Move: its name and what it holds, and Move… (the move sheet from it)
function moveRow(src) {
  const key = sheetKey('move', { 'data-from': src.id }, t('money.move.key'));
  return `<div class="venue"><span>${lines(src.name, [src.usd === null ? '' : money(src.usd)], src.agent ? t('money.move.agentWallet') : '')}</span><span class="btn-row">${key}</span></div>`;
}

function moneyTab(state) {
  const a = state.account;
  const unread = pageNote(a);
  if (unread !== null) return unread;
  const owner = signs(state);
  const rows = receiveRowsOf(a.data);
  const receive = box(`${title(t('money.receive.title'))}${rows.length ? `${note(t('money.receive.lead'))}<div class="venues">${rows.map(r => receiveRow(r, a.receive)).join('')}</div>` : note(noReceive())}`, th('money.receive.title'));
  let move = '';
  if (!writesOn(a.data)) move = box(`${title(t('money.move.title'))}${note(moveReadOnly())}`, th('money.move.title'));
  else if (owner) {
    const sources = moveSourcesOf(a.data);
    move = box(`${title(t('money.move.title'))}${sources.length ? `<div class="venues">${sources.map(moveRow).join('')}</div>` : note(noSource())}`, th('money.move.title'));
  }
  // the payments the Account built for the operator's own wallet (plan 4b Task 1), as Trade's Under way draws them
  const waiting = underWayOf(a.data).filter(o => o.payment)
    .map(o => walletRow(o.words, o.payment, o.key, { 'data-payment': o.payment }, o.walletReported, a.wallet, owner, ''));
  const wallet = waiting.length ? box(`${title(t('money.wallet.waiting'))}<div class="mk-wrap"><table class="mk-t tk-t"><tbody>${waiting.join('')}</tbody></table></div>`, th('money.wallet.waiting')) : '';
  return `<div class="cards">${receive}${move}${earnBox(state)}${wallet}</div>`;
}

// Earn (plan 4b Task 3; earn.js openEarn): what is in each product — its venue, asset, amount and yield — with Take out…, and Put
// in…, the keys on a page that signs for an Account that takes writes; the venues not served here named once, a read that
// failed and a key that can't earn each in their words; what the last taken earn said
const earnReadOnly = () => t('money.earn.readOnly');
function earnBox(state) {
  const a = state.account;
  const e = a.earn ?? {};
  const keys = signs(state) && writesOn(a.data);
  const said = e.said ? note(e.said) : '';
  if (!e.data) return box(`${title(t('money.earn.title'))}${said}${note(e.status === 'error' ? e.message || t('money.earn.unread') : t('common.loading'))}`, th('money.earn.title'));
  const l = earnListOf(e.data, a.data, 'withdraw');
  const rows = l.products.map(p => {
    const held = p.held ?? {};
    const facts = [p.venueName || p.venue, `${numWord(typeof held.amount === 'number' ? held.amount : null)} ${held.asset || p.asset}`, earnRate(typeof held.apy === 'number' ? { ...p, apy: held.apy, apyHigh: undefined } : p)].filter(Boolean).join(' · ');
    const out = keys && earnOutAt(a.data, p.venue) ? `<span class="btn-row">${sheetKey('earn', { 'data-venue': p.venue, 'data-side': 'withdraw', 'data-product': p.id }, t('money.earn.takeOut'))}</span>` : '';
    return `<div class="venue"><span>${lines(p.name || p.id, [facts])}</span>${out}</div>`;
  }).join('');
  const failedNote = e.status === 'error' ? note(e.message || t('money.earn.unread')) : '';
  const away = l.away.length ? note(t('money.notServed', { venues: l.away.map(m => m.venueName).join(', ') })) : '';
  const failed = l.failed.map(m => note(t('money.venueUnread', { venue: m.venueName, why: m.why }))).join('');
  const refusing = l.refusing.map(v => note(`${v.venueName}: ${v.why}`)).join('');
  const put = keys ? `<div class="btn-row">${sheetKey('earn', { 'data-side': 'supply' }, t('money.earn.putIn'))}</div>` : '';
  const ro = writesOn(a.data) ? '' : note(earnReadOnly());
  // a failed read says its refusal alone: the empty list's line is not drawn under it
  const list = rows ? `<div class="venues">${rows}</div>` : e.status === 'error' ? '' : note(t('money.earn.none'));
  return box(`${title(t('money.earn.title'))}${said}${failedNote}${list}${put}${ro}${away}${failed}${refusing}`, th('money.earn.title'));
}

// ── Sell many (plan 4b Task 3; earn.js openSellMany) ──


// a leg in the review or the run: its name and venue, then where it stands — asking, what it would sign, waiting, signing, or
// its answer where it landed
function smLeg(l, i) {
  const head = `<div><b>${esc(smLegName(l.item))}</b> · ${esc(l.item.venueName || l.item.venue)}</div>`;
  let body = '';
  if (l.state === 'asking') body = note(t('money.sellMany.asking'));
  else if (l.state === 'refused') body = `<p class="acct-note sm-no">${esc(l.why)}</p>`;
  else if (l.state === 'waiting') body = note(t('money.sellMany.waiting'));
  else if (l.state === 'signing') body = note(t('money.sellMany.signing'));
  else if (l.state === 'sold' || l.state === 'wallet') body = note(l.said);
  else if (l.state === 'ready') {
    const w = smLegWords(l);
    const shown = whatYouSignLines(l.prepared);
    body = (w ? `<div class="sheet-quote"><b>${esc(w.head)}</b>${w.usd ? ` <span class="dim">${esc(w.usd)}</span>` : ''}<br><span class="dim">${esc(w.path)}</span></div>` : '') +
      (shown.length ? `<details${attrs({ id: `sm-shown-${i}`, class: 'acct-shown' })}><summary>${th('money.sellMany.whatYouSign')}</summary>${shown.map(x => `<div class="dsec-line">${esc(x)}</div>`).join('')}</details>` : '');
  }
  return `<li${attrs({ class: 'sm-leg', 'data-leg': String(i) })}>${head}${body}</li>`;
}

/** Sell many's drawer: everything held that isn't a dollar, picked up to ten, reviewed leg by leg, then signed one by one —
 *  each leg's answer where it landed. Its words are the retired page's (earn.js:250-356). None open: nothing. */
export function renderSellMany(state) {
  const m = state.sellMany;
  if (!m) return '';
  const owner = signs(state);
  const venueName = m.venue ? (venuesOf(state.account.data).find(v => v.id === m.venue)?.name || m.venue) : '';
  const lead = note(venueName ? t('money.sellMany.leadAt', { venue: venueName, max: SELL_MANY_MAX }) : t('money.sellMany.lead', { max: SELL_MANY_MAX }));
  let body = '';
  if (m.status === 'reading') body = note(t('common.loading'));
  else if (m.status === 'picking') {
    const missing = (Array.isArray(m.missing) ? m.missing : []);
    const away = missing.filter(x => x.code === 'E_VENUE_GEOBLOCKED');
    const missed = (away.length ? note(t('money.notServed', { venues: [...new Set(away.map(x => x.venueName || x.venue))].join(', ') })) : '') +
      missing.filter(x => x.code !== 'E_VENUE_GEOBLOCKED').map(x => note(t('money.venueUnread', { venue: x.venueName || x.venue, why: x.why }))).join('');
    if (m.message) body = note(m.message);
    else if (!m.items.length) body = note(m.hidden ? tn('money.sellMany.noneReady', m.hidden) : t('money.sellMany.allDollars')) + missed;
    else {
      const picked = new Set(m.picked);
      const rows = m.items.map((x, i) => {
        const qty = Object.hasOwn(m.qtys ?? {}, i) ? m.qtys[i] : String(x.sellQty);
        const facts = [x.venueName || x.venue, t('money.sellMany.held', { qty: numWord(typeof x.held === 'number' ? x.held : null) }), typeof x.usd === 'number' ? `≈ ${money(x.usd)}` : ''].filter(Boolean).join(' · ');
        return `<li class="sm-row"><label class="sheet-check"><input${attrs({ type: 'checkbox', name: 'pick', value: String(i), checked: picked.has(i), 'data-action': 'sellManyPick', 'aria-label': t('money.sellMany.pick', { asset: x.asset, venue: x.venueName || x.venue }) })}>` +
          `<span>${lines(smLegName(x), [facts])}</span></label><input${attrs({ id: `sm-q-${i}`, class: 'input small', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: qty, 'data-action': 'sellManyQty', 'data-index': String(i), 'aria-label': t('money.sellMany.qty', { asset: x.asset }) })}></li>`;
      }).join('');
      const n = m.picked.length;
      const hidden = m.hidden ? note(tn('money.sellMany.hidden', m.hidden)) : '';
      body = `<ul class="sm-list" role="list">${rows}</ul>${hidden}${missed}${m.full ? note(t('money.sellMany.full', { max: SELL_MANY_MAX })) : ''}` +
        `<div class="btn-row"><button${attrs({ type: 'button', class: 'btn-primary', 'data-action': 'sellManyReview', disabled: !n })}>${esc(n ? tn('money.sellMany.reviewN', n) : t('money.sellMany.review'))}</button></div>`;
    }
  } else {
    const legs = `<ol class="sm-legs">${m.legs.map(smLeg).join('')}</ol>`;
    const ready = m.legs.filter(l => l.state === 'ready').length;
    const asking = m.legs.some(l => l.state === 'asking');
    let keys = '';
    if (m.status === 'reviewing') keys = `<div class="btn-row"><button type="button" class="btn-sm" data-action="sellManyBack">${th('money.sellMany.back')}</button><button${attrs({ type: 'button', class: 'btn-primary', 'data-action': 'sellManyRun', disabled: asking || !ready || !owner })}>${esc(t('money.sellMany.sign', { n: ready }))}</button></div>`;
    else if (m.status === 'done') keys = `${m.said ? note(m.said) : ''}<div class="btn-row"><button type="button" class="btn-sm" data-action="sellManyClose">${th('money.sellMany.finish')}</button></div>`;
    body = legs + keys;
  }
  return `<aside class="drawer" aria-label="${th('money.sellMany.title')}"><div class="drawer-head"><h2>${th('money.sellMany.title')}</h2><button type="button" class="close-key" data-action="sellManyClose" aria-label="${th('common.close')}">×</button></div>` +
    `<div class="drawer-body">${lead}${body}</div></aside>`;
}

// ── the drawers ──

// the Statement: the Account's lines newest first, each with who it was by, its status in the Account's word and its fee
// when it had one, and their CSV; the Account's sentence over them when its last read refused
export function renderStatement(state, now) {
  const st = state.account.statement;
  const rows = statementLinesOf(st.data).map(l => {
    const facts = [l.by, l.status, l.feeUsd === null ? '' : t('account.statement.fee', { fee: money(l.feeUsd) })].filter(Boolean).join(' · ');
    return `<div class="activity-row"><span class="dim">${esc(when(l.at, now))}</span>` +
      `<span class="activity-text">${esc(l.description)}${facts ? `<br><span class="dim">${esc(facts)}</span>` : ''}</span><span class="num">${esc(money(l.amountUsd))}</span></div>`;
  }).join('');
  const said = st.status === 'error' && st.message ? note(st.message) : '';
  const body = rows ? `<div class="activity">${rows}</div><div class="btn-row"><button type="button" class="btn-sm" data-action="exportStatement">${th('account.statement.export')}</button></div>`
    : readNote(st, t('account.statement.unavailable'), t('account.statement.none'));
  return `<aside class="drawer" aria-label="${th('account.statement.title')}"><div class="drawer-head"><h2>${th('account.statement.title')}</h2><button type="button" class="close-key" data-action="closeStatement" aria-label="${th('common.close')}">×</button></div>` +
    `<div class="drawer-body">${said}${body}</div></aside>`;
}

export function renderSettings(state) {
  // the Theme seg's labels are its values (app.js setTheme lower-cases one): Task 10 pairs each with its word
  const theme = { cream: 'Cream', black: 'Black' }[state.theme] ?? 'System'; // en-kept: the seg's values
  const themes = ['Cream', 'Black', 'System']; // en-kept: the seg's values
  return `<aside class="drawer" aria-label="${th('settings.title')}"><div class="drawer-head"><h2>${th('settings.title')}</h2><button type="button" class="close-key" data-action="closeSettings" aria-label="${th('common.close')}">×</button></div><div class="drawer-body">` +
    `<div class="dsec"><div class="dsec-label">${th('settings.theme')}</div>${seg(themes, theme, 'setTheme')}</div>${renderDevices(state)}</div></aside>`;
}

// the screen: the head, the Account's sentence when it refused, the tabs, the tab, and its drawer; app.js adds the Settings
// drawer as it does on every screen
export function renderAccountScreen(state, now) {
  const a = state.account;
  const tab = tabsOf().some(([id]) => id === state.route.tab) ? state.route.tab : 'portfolio';
  const statement = a.statementOpen && !state.settingsOpen;
  const venue = statement || state.settingsOpen || !a.detailsVenue ? null : venuesOf(a.data).find(v => v.id === a.detailsVenue) ?? null;
  const body = tab === 'money' ? moneyTab(state) : tab === 'venues' ? venues(state, now) : tab === 'agents' ? agentsTab(state, now) : tab === 'cards' ? cardsTab(state, now)
    : tab === 'rules' ? rulesTab(state, now) : tab === 'identity' ? renderIdentityTab(state, now) : portfolio(state, now);
  return `<main class="${cls('main', 'acct', (state.settingsOpen || statement || venue) && 'with-drawer')}">${head(state)}${a.message ? note(a.message) : ''}${tabs(state, tab)}${body}` +
    `${statement ? renderStatement(state, now) : ''}${venue ? venueDetails(venue, state) : ''}</main>`;
}
