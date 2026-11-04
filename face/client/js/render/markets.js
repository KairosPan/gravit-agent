// face/client/js/render/markets.js — Markets on the face (spec 2026-10-22 §6.1): the Account's markets in one table, by its
// tabs, with its sorts and its search — each row's price by kind and where the price is from, in the Account's own words —
// beside the A-share (cn:) rows, quoted by the Account too; and a market's page (#/markets/<key>) from the Account's reads: its
// price and 24 hours, its facts, its price history for the range chosen, its lines across venues, what is held, working and
// stated for it, the conversations that name it. A cn: page is the A share's own, from its quote and its history. Every figure and
// every word about a market is a view's (host/market-view.js): this module puts a figure in its unit's words, joins the views'
// words, and says, where rows or lines would be, how far their read has got. On a page that signs for the Account, an Account
// market's page carries Buy, and Sell where the market is held: each opens the Trade ticket (spec 2026-10-22 §6.4); and, for an
// Account that takes writes, a position's Close… (Sell…) and Leverage…, an open order's Change…, and a perpetual's Leverage…
// among its keys (plan 4a Task 3). An Account market's page draws, from the Account's four reads beside its price (plan 4a
// Task 4; host/market-depth-view.js): You here — the asset sheet's holding, positions with their cost, open orders with who
// placed them, and what agents do here — its order book, its latest trades, and a perpetual's funding; each as far as its own
// read has got. An A share's page reads none of the four. The last tab is the Desk (plan 2026-11-01-desk-p3-watch Task 11:
// render/desk.js over the desk's status), and a market the watch holds a level for carries its mark (host/desk-view.js markOf)
// after its name on its row, and with its plan and file under its price on its page.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { maskExcerpt } from '../mask.js';
import { chgHtml } from '../market-fmt.js';
import { fmtClock, fmtDate, rowTime, sameDay } from '../time.js';
import { price, number } from '../wire/market-model.js';
import { money, signedMoney, sign } from '../wire/account-model.js';
import { seg } from './controls.js';
import { candlesSvg, sessionsSvg } from './chart.js';
import { orderWords, marketKeysOn, marketKey, changeKey, positionKeys } from './account.js';
import { marketLeverageSeedOf } from '../host/sheet-market.js';
import { assetKeyOf, hereOf, costOf, bookOf, tradesOf, fundingOf, fundingMissingOf } from '../host/market-depth-view.js';
import {
  CANDLE_RANGES, isAccountKey, tableOf, pageOf, faceAssetOf, mentionsOf, volumeWordOf, followOf,
  connectionWord, watchWord, basisWord, watchedOf,
  chinaWord, cnStateWord, NOT_ANSWERING_WORD, cnPageOf, cnTileOf, cnBoardOf,
} from '../host/market-view.js';
import { yuan, fix2 } from './lunhui/block.js';
import { intradaySvg } from './lunhui/intraday.js';
import { tradeableOf } from '../host/trade-view.js';
import { isCnKey } from '../wire/china.js';
import { DESK_TAB, deskViewOf, markOf } from '../host/desk-view.js';
import { renderDeskTab } from './desk.js';

const EM = '—';
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
// a record's own entry, never one it inherits
const own = (o, k) => (isRecord(o) && typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined);
const note = text => (text ? `<p class="mk-note">${esc(text)}</p>` : '');
const empty = text => `<p class="mk-empty">${esc(text)}</p>`;
const tag = text => `<span class="mk-tag">${esc(text)}</span>`;
const tone = v => ({ pos: 'up', neg: 'down' })[sign(v)] ?? 'flat';
// a quantity as the Account gives it, grouped (0.124, 63,226.6); nothing given is no word
const qtyWord = n => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 }));
const when = (at, now) => { const t = Date.parse(at); return Number.isNaN(t) ? '' : sameDay(t, now) ? fmtClock(t) : `${fmtDate(t)} ${fmtClock(t)}`; };

/** A round letter tile: the first word of what it is given — a market's base, an event's category — four letters at most. */
export function mkAv(name, size = '') {
  const word = String(name ?? '').trim().split(/\s+/)[0].slice(0, 4);
  return `<span class="${cls('mk-av', size && `mk-av-${size}`)}" aria-hidden="true">${esc(word)}</span>`;
}

/** A price in its unit's words: an event's in cents (62¢, 62.5¢), an A share's in yuan, anything else in dollars; none is —. */
export function priceWord(v, unit) {
  if (v === null || v === undefined) return EM;
  return unit === 'cents' ? `${Number(v.toFixed(1))}¢` : price(v, unit === 'cny' ? 'CNY' : 'USD');
}

// the 24 hours, up or down: the glyph, the word a screen reader says, the size — a percent to two places, an event's move in
// cents — never the colour alone; nothing given is —
function moveHtml(p) {
  const cents = p.unit === 'cents';
  const v = cents ? p.change24h : p.changePct;
  if (v === null || v === undefined) return '<span class="flat">—</span>';
  const size = cents ? `${Number(Math.abs(v).toFixed(1))}¢` : `${Math.abs(v).toFixed(2)}%`;
  if (v === 0) return `<span class="flat">${size}</span>`;
  const up = v > 0;
  return `<span class="${up ? 'up' : 'down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span><span class="sr-only">${up ? 'up' : 'down'}</span> ${size}</span>`;
}

// ---- the table

// the star, and under it Watched at the Account for a market on the Account's own list alone; an old star the Account could not
// find takes Remove in its place
function starCell(r) {
  if (r.notListed) return `<button type="button" class="mk-clear" data-action="removeAsked" data-id="${esc(r.id)}" aria-label="Remove ${esc(r.name)}">Remove</button>`;
  return `<button type="button" class="mk-star" data-action="toggleWatch" data-id="${esc(r.id)}" aria-pressed="${r.watched === true}" aria-label="${r.watched ? 'Stop watching' : 'Watch'} ${esc(r.name)}">${icon('star', 18, 2)}</button>` +
    (r.watched === true && r.atAccount === true ? '<span class="mk-at">Watched at the Account</span>' : '');
}

// the tile, the name and under it the sub, Closed past its end, Paper where only a paper account trades it first; a market no
// read lists, and a star the Account could not find, have no page to open
function nameCell(r, mark = null) {
  const tags = [r.pastEnd ? 'Closed' : '', r.paper ? 'Paper' : ''].filter(Boolean).map(tag).join(' ');
  const inner = `${mkAv(r.tile)}<span class="mk-nm"><b>${esc(r.name)}</b>${mark ? levelMark(mark) : ''}<span class="mk-sub">${esc(r.sub)}${tags ? ` ${tags}` : ''}</span></span>`;
  return r.placeholder || r.notListed ? `<span class="mk-who">${inner}</span>`
    : `<button type="button" class="mk-name" data-action="openMarket" data-id="${esc(r.id)}">${inner}</button>`;
}

// a row's volume: an A share's turnover in yuan (China's rows), else the view's word in its unit
const volumeCell = p => (p.volumeUnit === 'yuan' ? yuan(p.volume) : volumeWordOf(p));

function row(r, markFor) {
  return `<tr data-id="${esc(r.id)}"><td>${starCell(r)}</td><td class="mk-c-name">${nameCell(r, markFor(r.id))}</td>` +
    `<td class="r">${esc(priceWord(r.price, r.priced.unit))}</td><td class="r mk-c-chg">${moveHtml(r.priced)}</td>` +
    `<td class="r mk-c-vol">${esc(volumeCell(r.priced))}</td><td class="r mk-c-st"><span class="mk-st">${esc(r.sourceWord)}</span></td></tr>`;
}

// China's table says Today and Turnover where the Account's say 24h and Volume (spec 2026-10-31 §4)
function table(rows, { china = false, markFor = () => null } = {}) {
  const head = '<tr><th scope="col"><span class="sr-only">Watch</span></th><th scope="col" class="mk-c-name">Market</th><th scope="col" class="r">Price</th>' +
    `<th scope="col" class="r mk-c-chg">${china ? 'Today' : '24h'}</th><th scope="col" class="r mk-c-vol">${china ? 'Turnover' : 'Volume'}</th><th scope="col" class="r mk-c-st">Source</th></tr>`;
  return `<section class="cardbox mk-tcard" aria-label="Markets"><div class="mk-wrap"><table class="mk-t"><thead>${head}</thead><tbody>${rows.map(r => row(r, markFor)).join('')}</tbody></table></div></section>`;
}

// where the rows would be when there are none, from the read they are from: nothing starred; an answer with nothing in it; a
// read still on its way; or one that failed before it answered
function emptyWord(read, tab, searching) {
  if (tab === 'watching' && !searching) return 'Nothing watched yet';
  if (tab === 'china' && !searching) return read.status === 'error' ? 'China unavailable' : read.answered && read.status === 'ready' ? 'No markets' : 'Loading…';
  if (read.answered) return 'No markets';
  if (read.status !== 'error') return searching ? 'Searching…' : 'Loading…';
  return searching ? 'Search is unavailable' : 'Markets unavailable';
}

// the search's A shares, while a query is active: the Account answered without China's hits (its `missing` names china) —
// Search is unavailable for them; else nothing (their hits drawn, or none matching)
function cnSearchWord(m, searching) {
  const body = m.results?.data;
  const missed = body?.ok === true && records(body.missing).some(x => x.venue === 'china');
  return searching && missed ? 'Search is unavailable' : '';
}

// China's muted lines: the session's (Closed, the midday break); then the Account's own words when it says China's read is stale,
// else, for a ranking the proxy re-served as last read (the Account not answering), that; else a refresh that failed over the
// rows kept
function chinaLines(read, data, session) {
  const why = data?.status?.state === 'stale' ? String(data.status.said ?? '').trim()
    : data?.stale === true ? NOT_ANSWERING_WORD
    : read.status === 'error' && read.answered ? 'Couldn’t refresh China' : '';
  return note(chinaWord(session)) + note(why);
}

export function renderMarketsScreen(state, now) {
  const id = state.route?.screen === 'markets' ? state.route.id : null;
  if (id) {
    const page = marketPage(id, state, now);
    if (page) return page;
  }
  const m = state.markets;
  const q = String(m.q ?? '').trim();
  const searching = q !== '';
  const { rows, tabs, sorts, sort, read, china, session } = tableOf(m, now, state.account?.data);
  const tabsHtml = `<div class="mk-tabs" role="group" aria-label="Markets">${tabs.map(t => `<button type="button" class="mk-tab" data-action="mkTab" data-value="${esc(t.id)}" aria-pressed="${t.id === m.tab}">${esc(t.count === null ? t.label : `${t.label} · ${t.count.toLocaleString('en-US')}`)}</button>`).join('')}</div>`;
  const left = searching
    ? `<p class="mk-q">${rows.length} market${rows.length === 1 ? '' : 's'} for “${esc(q)}” <button type="button" class="mk-clear" data-action="mkClear">Clear</button></p>`
    : '<span></span>';
  const bar = `<div class="mk-bar">${left}${rows.length > 1 ? seg(sorts.map(s => [s.label, s.id]), sort, 'mkSort') : ''}</div>`;
  // the Desk tab (plan 2026-11-01-desk-p3-watch Task 11): the desk's view in place of the table
  if (m.tab === DESK_TAB && !searching) {
    const desk = isRecord(state.desk) ? state.desk : {};
    return screenHtml(m, tabsHtml, renderDeskTab(deskViewOf(desk.data, new Date(now).toISOString()), desk));
  }
  // the muted lines: the Account's own sentence when the read the rows are from refused, the A-share search's when it failed or
  // answered in part (said once: not again under a table that already says it), the face's wire's state where an A share is
  // drawn, the watchlist's
  const emptyText = rows.length ? '' : emptyWord(read, m.tab, searching);
  const cnSearch = cnSearchWord(m, searching);
  const cnDrawn = rows.some(r => r.source === 'face' && !r.notListed);
  const chinaWords = china ? chinaLines(read, m.rank?.data, session) : '';
  // China's failure is said once, in the face's words: the route's own error text is not a sentence of the Account's
  const words = chinaWords + note(china ? '' : read.message) + note(cnSearch !== emptyText ? cnSearch : '') + (cnDrawn ? note(connectionWord(m.connection)) : '') + note(watchWord(m.watchError));
  const body = rows.length ? table(rows, { china, markFor: id => markOf(state.desk?.data, id) }) : empty(emptyText);
  return screenHtml(m, tabsHtml, `${bar}${words}${body}`);
}

// the screen: its head with the search, the tabs, and what the tab draws
const screenHtml = (m, tabsHtml, inner) => `<main class="main mkts"><div class="mk-head"><h1 class="head-title">Markets</h1>` +
  `<div class="search"><label for="mq" class="sr-only">Search markets</label>${icon('search', 18, 2)}<input id="mq" type="search" autocomplete="off" placeholder="Search markets" data-action="mkQuery"${attrs({ value: m.q })}></div></div>` +
  `<div class="mk">${tabsHtml}${inner}</div></main>`;

// a level's mark (host/desk-view.js markOf): after a row's name, and on a market's page under its price with its plan and file
const levelMark = mark => `<span class="mk-level">${esc(mark.label)}</span>`;
const planHtml = mark => (mark ? `<p class="mk-plan">${levelMark(mark)} ${esc(`${mark.plan} · ${mark.file}`)}</p>` : '');

// ---- a market's page: its head and keys, the price and its facts, then its history and its lines across venues beside what you
// hold of it, what is working, the conversations that name it and the statement's lines

const section = (label, inner, key = '') => `<section class="dsec" aria-label="${label}">${key ? `<div class="mk-sec-head"><div class="mk-h2">${label}</div>${key}</div>` : `<div class="mk-h2">${label}</div>`}${inner}</section>`;
const line = (mark, t1, t2 = '', markClass = '', tail = '') => `<div class="mk-line"><span class="${cls('mk-mark', markClass)}">${mark}</span><div class="mk-line-b"><div class="mk-t1">${t1}</div>${t2 ? `<div class="mk-t2">${t2}</div>` : ''}</div>${tail}</div>`;
const feed = lines => `<div class="mk-feed">${lines.join('')}</div>`;
const pageHtml = (who, keys, top, left, right) => {
  const cols = [left, right].filter(c => c.length).map(c => `<div class="mk-pg-col">${c.join('')}</div>`).join('');
  return `<main class="main mkts mk-page"><a id="page-back" class="back-link page-back" href="#/markets">‹ Markets</a><div class="mk-pg">` +
    `<header class="mk-pg-head">${who}${keys}</header><div class="mk-pg-top">${top}</div>` +
    `${cols ? `<div class="mk-pg-cols">${cols}</div>` : ''}</div></main>`;
};
// a key opening the Trade ticket on the market, at a side
const ticketKey = (id, side, word) => `<button type="button" class="btn" data-action="openTicket" data-id="${esc(id)}" data-side="${side}">${word}</button>`;
// the page's keys: Buy, and Sell where it is held, when `trade` is given (an Account market on a page that signs); Hand to
// Gravit; Watch — and a perpetual's Leverage… (`leverage`, its seed) where it is given
const keysHtml = (id, watched, trade = null, leverage = null) => `<div class="mk-d-acts">${trade ? ticketKey(id, 'buy', 'Buy') + (trade.held ? ticketKey(id, 'sell', 'Sell') : '') : ''}` +
  `${leverage ? marketKey('leverage', leverage, 'Leverage…', 'btn') : ''}` +
  `<button type="button" class="btn" data-action="handToGravit" data-id="${esc(id)}">${icon('agent', 16, 2)}Hand to Gravit</button>` +
  `<button type="button" class="${cls('btn', watched && 'mk-on')}" data-action="toggleWatch" data-id="${esc(id)}" aria-pressed="${watched}">${icon('star', 16, 2)}${watched ? 'Watching' : 'Watch'}</button></div>`;
const aboutHtml = (conversations, asset, now) => mentionsOf(conversations, asset).map(c => `<a class="mk-line" href="#/messages/${esc(c.id)}" data-action="open" data-id="${esc(c.id)}"><span class="mk-mark">→</span>` +
  `<div class="mk-line-b"><div class="mk-t1">${esc(maskExcerpt(c.title))}</div>${c.updatedAt ? `<div class="mk-t2">${esc(rowTime(c.updatedAt, now))}</div>` : ''}</div></a>`);

// a part of the page as its read allows (the view's `reads`): Loading… until that read has answered, and once it has failed
// before any answer the Account's sentence over <unavailable>; after an answer its lines, or <none> — a later failure's sentence
// over the lines kept
function partBody(r, lines, none, unavailable) {
  const said = r.failed ? note(r.message) : '';
  if (!r.answered) return `${said}${empty(r.failed ? unavailable : 'Loading…')}`;
  return `${said}${lines.length ? feed(lines) : none ? empty(none) : ''}`;
}

/** A market's page, or '' for an id no read lists (the screen then draws the table): an A share's (a cn: id) its own, from its
 *  quote and history, reached cold or not; another Account key's from its reads. */
export function marketPage(id, state, now) {
  if (!isCnKey(id) && isAccountKey(id)) {
    const view = pageOf(state.markets, state.account, id, now);
    return view ? accountPage(id, view, state, now) : '';
  }
  const asset = faceAssetOf(state.markets, id);
  return asset?.market === 'cn' ? cnPage(asset, state, now) : '';
}

// a statement line done: its mark is a tick
const DONE = new Set(['filled', 'settled']);

// ---- the four reads beside the price (plan 4a Task 4)

// a part of the four as its read allows: Loading… until it has answered, and once it has failed before any answer the
// Account's sentence over <unavailable>; after an answer what `draw` draws — under a later failure's sentence, and, for an
// answer the proxy re-served as kept (`stale: true`), As of the time it is from (`timeOf`: the source's own stamp, else the
// last fresh answer's landing)
function depthBody(part, draw, unavailable, now, timeOf = () => '') {
  const p = isRecord(part) ? part : {};
  const data = p.data;
  // a read lands its answer only once it has one
  const answered = data != null;
  const said = p.status === 'error' ? note(p.message) : '';
  if (!answered) return `${said}${empty(p.status === 'error' ? unavailable : 'Loading…')}`;
  const stale = isRecord(data) && data.stale === true;
  const at = stale ? (timeOf() || (typeof p.freshAt === 'number' ? new Date(p.freshAt).toISOString() : '')) : '';
  const asOf = stale ? note(at ? `As of ${when(at, now)}` : 'As of the last read') : '';
  return `${said}${asOf}${draw()}`;
}

// what was paid, under a holding or a position: the average paid in the market's unit and the cost, then the Account's words
function costWords(c, unit) {
  if (!c) return '';
  const avg = c.avgCostUsd === null ? '' : `avg ${priceWord(unit === 'cents' ? c.avgCostUsd * 100 : c.avgCostUsd, unit)}`;
  return [avg, c.costUsd === null ? '' : `cost ${money(c.costUsd)}`, c.words].filter(Boolean).join(' · ');
}

// You here: the venues the sheet could not read; the holding, the positions with their cost and keys, the owner's open orders
// with Change…; and under What agents do here a line per agent action — an order of theirs working here (with its Change…), a
// statement line by them — so an agent's order is drawn once. A market the asset read does not name (an event no venue connected lists) holds nothing here.
function youHere(view, part, here, keyed, page, now, quotes = null) {
  if (!assetKeyOf(view.item)) return empty('You don’t hold any.');
  const unit = view.priced.unit;
  const tail = keys => (keys.length ? `<span class="btn-row">${keys.join('')}</span>` : '');
  return depthBody(part, () => {
    const h = here.held;
    const lines = [
      ...(h ? [line('·', esc(`${[qtyWord(h.amount), h.asset].filter(Boolean).join(' ')} · ${money(h.usd)}`), esc(costWords(costOf(here, { key: h.key }), unit)))] : []),
      ...(here.paperHeld ? [line('·', `${esc(`${[qtyWord(here.paperHeld.amount), here.paperHeld.asset].filter(Boolean).join(' ')} · ${money(here.paperHeld.usd)}`)} ${tag('Paper')}`,
        esc(costWords(costOf(here, { key: here.paperHeld.key, paper: true }), unit)))] : []),
      ...here.positions.map(p => line('·', `${esc(`${p.venueName || p.venue} · ${[p.side, qtyWord(p.qty), p.symbol].filter(Boolean).join(' ')} · `)}` +
        `<span class="${tone(p.unrealizedUsd)}">${esc(signedMoney(p.unrealizedUsd))}</span>${p.paper ? ` ${tag('Paper')}` : ''}`,
        esc(costWords(costOf(here, p), unit)), '', keyed ? tail(positionKeys(p, page, quotes)) : '')),
      ...here.orders.filter(o => o.who === 'You').map(o => line('·', esc(orderWords(o)), '', '', keyed ? tail([changeKey(o, page)].filter(Boolean)) : '')),
    ];
    const agents = here.agents.map(a => (a.type === 'order' ? line('·', esc(orderWords(a.order)), '', '', keyed ? tail([changeKey(a.order, page)].filter(Boolean)) : '')
      : line(DONE.has(a.line.status) ? '✓' : '·', esc([when(a.line.at, now), a.line.description, money(a.line.amountUsd)].filter(Boolean).join(' · ')),
        esc([a.line.status, a.line.by].filter(Boolean).join(' · ')), DONE.has(a.line.status) ? 'ok' : '')));
    return here.missing.map(note).join('') + (lines.length ? feed(lines) : empty('You don’t hold any.')) +
      (agents.length ? `<div class="mk-h3">What agents do here</div>${feed(agents)}` : '');
  }, 'Account unavailable', now);
}

// a figure of the book or the trades in the market's unit (an event's in cents), a size as the source gives it
const unitPrice = (v, unit) => priceWord(v === null ? null : unit === 'cents' ? Number((v * 100).toPrecision(12)) : v, unit);
const sizeWord = n => (n === null || n === undefined ? EM : qtyWord(n));

// the order book: ten levels a side, best first, bids beside asks; whose book it is, in its words; Top of book only for a book
// that is the best bid and ask alone
function bookHtml(b, unit) {
  const rows = Math.min(10, Math.max(b.bids.length, b.asks.length));
  if (!rows) return empty('No orders on the book.');
  const cell = (l, side) => (l ? `<td class="r ${side}">${esc(unitPrice(l.price, unit))}</td><td class="r">${esc(sizeWord(l.size))}</td>` : '<td></td><td></td>');
  const body = Array.from({ length: rows }, (_, i) => `<tr>${cell(b.bids[i], 'up')}${cell(b.asks[i], 'down')}</tr>`).join('');
  return `<table class="mk-book"><thead><tr><th scope="col" class="r">Bid</th><th scope="col" class="r">Size</th><th scope="col" class="r">Ask</th><th scope="col" class="r">Size</th></tr></thead>` +
    `<tbody>${body}</tbody></table>${note([b.from, b.depth === 'top' ? 'Top of book only' : ''].filter(Boolean).join(' · '))}`;
}

// the latest trades: twenty, newest first — the price, the size, the side that took where the source says it, when — or the
// Account's sentence when the source publishes none
function tradesHtml(t, unit, now) {
  if (!t.trades.length) return empty(t.none || 'No trades yet.');
  return feed(t.trades.slice(0, 20).map(x => line('·', esc([unitPrice(x.price, unit), sizeWord(x.size)].join(' · ')),
    esc([x.side === 'buy' ? 'Buy' : x.side === 'sell' ? 'Sell' : '', when(x.at, now)].filter(Boolean).join(' · ')), x.side === 'buy' ? 'up' : x.side === 'sell' ? 'down' : '')));
}

// a perpetual's funding: what was paid out of the position, what was received, each hour's line newest first; None yet. when
// there is none
function fundingHtml(lines, now) {
  if (!lines.length) return empty('None yet.');
  return feed(lines.map(l => {
    const paid = l.usd === null ? '' : l.usd >= 0 ? `Paid ${money(l.usd)}` : `Received ${money(-l.usd)}`;
    const rate = l.rate === null ? '' : `rate ${(l.rate * 100).toFixed(4)}%`;
    return line('·', `${esc(paid || EM)}${l.paper ? ` ${tag('Paper')}` : ''}`,
      esc([when(l.at, now), l.venueName, [l.side, qtyWord(l.qty)].filter(Boolean).join(' '), rate].filter(Boolean).join(' · ')), l.usd !== null && l.usd < 0 ? 'ok' : '');
  }));
}

function accountPage(id, view, state, now) {
  const { priced } = view;
  const unit = priced.unit;
  const closes = view.closesAt ? `closes ${fmtDate(Date.parse(view.closesAt))}` : '';
  const who = `<div class="mk-who">${mkAv(view.tile, 'lg')}<div><h1 class="head-title">${esc(view.name)}</h1>` +
    `<span class="mk-sub">${esc([...view.sub, closes].filter(Boolean).join(' · '))}${view.item.pastEnd === true ? ` ${tag('Closed')}` : ''}</span></div></div>`;

  // the price it shows, its 24 hours and its volume the explore read's; where the price is from, with its age, once, under it, as
  // the retired page says it; an event's outcomes under the price
  const moved = (unit === 'cents' ? priced.change24h : priced.changePct) !== null;
  const outcomes = view.outcomes.map(o => `<span class="mk-out">${esc(`${o.label} ${priceWord(o.cents, 'cents')}`)}</span>`);
  const facts = [['24h volume', volumeWordOf(priced)], ['Venues', String(view.legs.length)]];
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(priceWord(view.price, unit))}</span>${moved ? `${moveHtml(priced)}<span class="mk-basis">24h</span>` : ''}</div>` +
    `${outcomes.length ? `<div class="mk-outs">${outcomes.join('')}</div>` : ''}${view.sourceWord ? `<p class="mk-asof">${esc(view.sourceWord)}</p>` : ''}` +
    planHtml(markOf(state.desk?.data, id)) +
    `<dl class="mk-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

  const left = [];
  const right = [];
  // Price history: the Account's ranges, the one kept pressed. Under it, a failed read's sentence (else History unavailable); the
  // closes kept for the range, with the Account's own words under them, or No history when it answered with fewer than two —
  // kept while the range is read again; Loading… while a range not drawn yet is read; nothing before a read
  const h = view.history;
  const svg = h.current ? candlesSvg(view.candles.candles, { unit, range: view.range }) : '';
  const failed = h.status === 'error' ? note(h.message || 'History unavailable') : '';
  const closesDrawn = h.current ? (svg ? svg + note([view.candles.ends, view.candles.note].filter(w => typeof w === 'string' && w.trim() !== '').join(' · ')) : note('No history'))
    : h.status === 'loading' ? note('Loading…') : '';
  left.push(section('Price history', failed + closesDrawn, seg(CANDLE_RANGES.map(r => [r, r]), view.range, 'setRange', { 'data-id': id })));
  // Across venues: the lines the owner connected, the best marked, Paper where so; a public listing leads to Venues to connect
  const venues = view.legs.map(l => line('·',
    `${esc([l.venueName || l.venue, l.symbol, priceWord(l.price, unit)].filter(Boolean).join(' · '))}${l.best ? ` ${tag('Best')}` : ''}${l.paper ? ` ${tag('Paper')}` : ''}`,
    '', '', !l.connected && l.public ? '<a class="link mk-link" href="#/account/venues">Connect to trade</a>' : ''));
  if (venues.length) left.push(section('Across venues', feed(venues)));

  // You here, from the asset sheet: what is held of it, its positions with their cost, its open orders with who placed them, and
  // what agents do here; on a page that signs for an Account that takes writes, a position's Close… (Sell…) and Leverage…, an
  // order's Change…
  const keyed = marketKeysOn(state);
  const page = state.account?.data;
  const kept = own(state.markets?.depth, id);
  const depth = Object.fromEntries(['here', 'book', 'trades', 'funding'].map(k => [k, isRecord(own(kept, k)) ? kept[k] : {}]));
  const here = hereOf(depth.here.data, page);
  const hereAnswered = depth.here.data != null;
  right.push(section('You here', youHere(view, depth.here, here, keyed, page, now, state.markets?.accountQuotes)));
  // the order book and the latest trades at the line the page follows
  const follows = followOf(view.item) !== null;
  if (follows) {
    left.push(section('Order book', depthBody(depth.book, () => bookHtml(bookOf(depth.book.data), unit), 'Order book unavailable', now,
      () => bookOf(depth.book.data).at)));
    left.push(section('Latest trades', depthBody(depth.trades, () => tradesHtml(tradesOf(depth.trades.data), unit, now), 'Trades unavailable', now,
      () => tradesOf(depth.trades.data).trades[0]?.at ?? '')));
  }
  // a perpetual's funding: what was paid and received at its lines
  if (view.item.kind === 'perp') {
    // the one read at every venue that lists it, as the retired page reads it: the venues of the page's lines it could not
    // read said under the lines, Not read: …; Unavailable only when the read itself failed
    const connected = view.legs.filter(l => l.connected === true);
    const body = depth.funding.data;
    right.push(section('Funding', depthBody(depth.funding, () => fundingHtml(fundingOf([body], connected.map(l => l.symbol)), now) +
      note(fundingMissingOf(body, connected.map(l => l.venue))), 'Funding unavailable', now)));
  }
  const about = aboutHtml(state.conversations, view.about, now);
  if (about.length) right.push(section('Gravit on it', feed(about)));
  const stated = view.lines.map(l => line(DONE.has(l.status) ? '✓' : '·', esc([when(l.at, now), l.description, money(l.amountUsd)].filter(Boolean).join(' · ')),
    esc([l.status, l.by].filter(Boolean).join(' · ')), DONE.has(l.status) ? 'ok' : ''));
  right.push(section('On the statement', partBody(view.reads.lines, stated, 'Nothing on the statement about it yet.', 'Statement unavailable'),
    '<button type="button" class="link mk-link" data-action="openStatement">Open the Statement →</button>'));
  // the hand order is the owner's: Buy and Sell only on a page that signs, for a market of a Trade kind (a perpetual, a pre-IPO
  // one, is listed, not traded from the face), Sell only where something of it is held
  // what is held is the asset sheet's once it has answered, else the holdings' as the page read them
  const holds = hereAnswered ? here.held !== null || here.paperHeld !== null || here.positions.length > 0 : view.held.assets.length > 0 || view.held.positions.length > 0;
  const trade = state.owner?.role === 'signs' && tradeableOf(view.item) ? { held: holds } : null;
  // a perpetual's Leverage…: its first connected line whose venue sets leverage, the leverage held there
  const leverage = keyed ? marketLeverageSeedOf(view.item, view.legs, hereAnswered ? here.positions : view.held.positions, page, state.markets?.accountQuotes) : null;
  return pageHtml(who, keysHtml(id, view.watched, trade, leverage), top, left, right);
}

// an A share's page: its quote (the Account's) against the previous close, its facts, the conversations that name it
// a figure of the A-share page in its unit's words (spec 2026-10-31 §5): yuan prices, yuan amounts in 万/亿/万亿, percents,
// a ratio with U+2212 for a negative, shares in 万股/亿股; none is —
function factWord({ value: v, unit }) {
  if (v === null || v === undefined) return EM;
  if (unit === 'cny') return price(v, 'CNY');
  if (unit === 'yuan') return yuan(v);
  if (unit === 'pct') return `${fix2(v)}%`;
  if (unit === 'ratio') return fix2(v);
  if (unit === 'shares') return v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿股` : v >= 1e4 ? `${Math.round(v / 1e4)}万股` : `${Math.round(v)}股`;
  return String(v);
}

// an A share's price history at its range: 1D the session chart, 5D the sessions on one grid, longer the closes in yuan on Beijing
// dates; the notes as on the retired page
function cnHistory(view) {
  const h = view.history;
  const svg = !h.current ? ''
    : view.range === '1D' ? (h.sessions?.length ? intradaySvg(h.sessions.at(-1)) : '')
      : view.range === '5D' ? sessionsSvg(h.sessions)
        : candlesSvg(h.candles, { unit: 'cny', zone: 'Asia/Shanghai', range: view.range });
  const failed = h.status === 'error' ? note(h.message || 'History unavailable') : '';
  const drawnNow = h.current ? (svg || note('No history')) : h.status === 'loading' ? note('Loading…') : '';
  return failed + drawnNow;
}

function cnPage(asset, state, now) {
  const m = state.markets;
  const view = cnPageOf(m, asset.id);
  const quote = view.quote;
  // starred as the press reads it (app.js toggles by watchedOf): the Account keys, the page's china entry, an old cn star
  const watched = watchedOf(m, asset.id, state.account?.data);
  const sub = ['A-share', asset.symbol, cnBoardOf(asset.symbol)].filter(Boolean).join(' · ');
  const who = `<div class="mk-who">${mkAv(cnTileOf(asset.name, asset.symbol), 'lg')}<div><h1 class="head-title">${esc(asset.name || asset.symbol)}</h1><span class="mk-sub">${esc(sub)}</span></div></div>`;
  const priced = number(quote?.price) !== null;
  const stateWord = cnStateWord(quote, m.connection, m.providers);
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(price(quote?.price, asset.currency))}</span>` +
    `${priced ? `${chgHtml(number(quote.change_pct))}<span class="mk-basis">${esc(basisWord(quote))}</span>` : ''}</div>` +
    `${stateWord ? `<p class="mk-asof">${esc(stateWord)}</p>` : ''}${planHtml(markOf(state.desk?.data, asset.id))}` +
    `<dl class="mk-facts">${view.facts.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(factWord(f))}</dd></div>`).join('')}</dl>`;
  const left = [section('Price history', cnHistory(view), seg(CANDLE_RANGES.map(r => [r, r]), view.range, 'setRange', { 'data-id': asset.id }))];
  const about = aboutHtml(state.conversations, asset, now);
  return pageHtml(who, keysHtml(asset.id, watched), top, left, about.length ? [section('Gravit on it', feed(about))] : []);
}
