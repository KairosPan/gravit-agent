// face/client/js/render/markets.js — Markets on the face (spec 2026-10-22 §6.1): the Account's markets in one table, by its
// tabs, with its sorts and its search — each row's price by kind and where the price is from, in the Account's own words —
// beside the face's own A-share (cn:) rows, quoted by the face's wire; and a market's page (#/markets/<key>) from the Account's
// reads: its price and 24 hours, its facts, its price history for the range chosen, its lines across venues, what is held,
// working and stated for it, the conversations that name it. A cn: page is the face's own quote, as before. Every figure and
// every word about a market is a view's (host/market-view.js): this module puts a figure in its unit's words, joins the views'
// words, and says, where rows or lines would be, how far their read has got. No Buy, no Sell, no Trade: the hand order is stage 2.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { chgHtml } from '../market-fmt.js';
import { fmtClock, fmtDate, rowTime, sameDay } from '../time.js';
import { price, number } from '../wire/market-model.js';
import { money, signedMoney, sign } from '../wire/account-model.js';
import { seg } from './controls.js';
import { candlesSvg } from './chart.js';
import { orderWords } from './account.js';
import {
  CANDLE_RANGES, isAccountKey, tableOf, pageOf, faceAssetOf, mentionsOf, volumeWordOf,
  quoteWord, connectionWord, searchWord, watchWord, volumeWord, basisWord, sourceWord,
} from '../host/market-view.js';

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

// a price in its unit's words: an event's in cents (62¢, 62.5¢), an A share's in yuan, anything else in dollars; none is —
function priceWord(v, unit) {
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

// the star; an old star the Account could not find takes Remove in its place
function starCell(r) {
  if (r.notListed) return `<button type="button" class="mk-clear" data-action="removeAsked" data-id="${esc(r.id)}" aria-label="Remove ${esc(r.name)}">Remove</button>`;
  return `<button type="button" class="mk-star" data-action="toggleWatch" data-id="${esc(r.id)}" aria-pressed="${r.watched === true}" aria-label="${r.watched ? 'Stop watching' : 'Watch'} ${esc(r.name)}">${icon('star', 18, 2)}</button>`;
}

// the tile, the name and under it the sub, Closed past its end, Paper where only a paper account trades it first; a market no
// read lists, and a star the Account could not find, have no page to open
function nameCell(r) {
  const tags = [r.pastEnd ? 'Closed' : '', r.paper ? 'Paper' : ''].filter(Boolean).map(tag).join(' ');
  const inner = `${mkAv(r.tile)}<span class="mk-nm"><b>${esc(r.name)}</b><span class="mk-sub">${esc(r.sub)}${tags ? ` ${tags}` : ''}</span></span>`;
  return r.placeholder || r.notListed ? `<span class="mk-who">${inner}</span>`
    : `<button type="button" class="mk-name" data-action="openMarket" data-id="${esc(r.id)}">${inner}</button>`;
}

function row(r) {
  return `<tr data-id="${esc(r.id)}"><td>${starCell(r)}</td><td class="mk-c-name">${nameCell(r)}</td>` +
    `<td class="r">${esc(priceWord(r.price, r.priced.unit))}</td><td class="r mk-c-chg">${moveHtml(r.priced)}</td>` +
    `<td class="r mk-c-vol">${esc(volumeWordOf(r.priced))}</td><td class="r mk-c-st"><span class="mk-st">${esc(r.sourceWord)}</span></td></tr>`;
}

function table(rows) {
  const head = '<tr><th scope="col"><span class="sr-only">Watch</span></th><th scope="col" class="mk-c-name">Market</th><th scope="col" class="r">Price</th>' +
    '<th scope="col" class="r mk-c-chg">24h</th><th scope="col" class="r mk-c-vol">Volume</th><th scope="col" class="r mk-c-st">Source</th></tr>';
  return `<section class="cardbox mk-tcard" aria-label="Markets"><div class="mk-wrap"><table class="mk-t"><thead>${head}</thead><tbody>${rows.map(row).join('')}</tbody></table></div></section>`;
}

// where the rows would be when there are none, from the read they are from: nothing starred; an answer with nothing in it; a
// read still on its way (and, while searching, the face's own search for the A shares); or one that failed before it answered
function emptyWord(read, tab, searching, search) {
  if (tab === 'watching' && !searching) return 'Nothing watched yet';
  const busy = searching && search?.status === 'loading';
  if (read.answered && !busy) return 'No markets';
  if (read.status !== 'error' || busy) return searching ? 'Searching…' : 'Loading…';
  return searching ? 'Search is unavailable' : 'Markets unavailable';
}

// the face's own search for the A shares, while a query is active: its failure, or its answer when it says it is partial, in its
// own words — never its silence; its other states are the table's (its hits drawn, Searching…, No markets)
function cnSearchWord(m, searching) {
  const s = m.search;
  const said = s?.status === 'error' || (s?.status === 'success' && s.partial === true && records(s.assets).length > 0);
  return searching && said ? searchWord(s) : '';
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
  const { rows, tabs, sorts, sort, read } = tableOf(m, now);
  const tabsHtml = `<div class="mk-tabs" role="group" aria-label="Markets">${tabs.map(t => `<button type="button" class="mk-tab" data-action="mkTab" data-value="${esc(t.id)}" aria-pressed="${t.id === m.tab}">${esc(t.count === null ? t.label : `${t.label} · ${t.count}`)}</button>`).join('')}</div>`;
  const left = searching
    ? `<p class="mk-q">${rows.length} market${rows.length === 1 ? '' : 's'} for “${esc(q)}” <button type="button" class="mk-clear" data-action="mkClear">Clear</button></p>`
    : '<span></span>';
  const bar = `<div class="mk-bar">${left}${rows.length > 1 ? seg(sorts.map(s => [s.label, s.id]), sort, 'mkSort') : ''}</div>`;
  // the muted lines: the Account's own sentence when the read the rows are from refused, the A-share search's when it failed or
  // answered in part (said once: not again under a table that already says it), the face's wire's state where an A share is
  // drawn, the watchlist's
  const emptyText = rows.length ? '' : emptyWord(read, m.tab, searching, m.search);
  const cnSearch = cnSearchWord(m, searching);
  const cnDrawn = rows.some(r => r.source === 'face' && !r.notListed);
  const words = note(read.message) + note(cnSearch !== emptyText ? cnSearch : '') + (cnDrawn ? note(connectionWord(m.connection)) : '') + note(watchWord(m.watchError));
  const body = rows.length ? table(rows) : empty(emptyText);
  return `<main class="main mkts"><div class="mk-head"><h1 class="head-title">Markets</h1>` +
    `<div class="search"><label for="mq" class="sr-only">Search markets</label>${icon('search', 18, 2)}<input id="mq" type="search" autocomplete="off" placeholder="Search markets" data-action="mkQuery"${attrs({ value: m.q })}></div></div>` +
    `<div class="mk">${tabsHtml}${bar}${words}${body}</div></main>`;
}

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
const keysHtml = (id, watched) => `<div class="mk-d-acts"><button type="button" class="btn" data-action="handToGravit" data-id="${esc(id)}">${icon('agent', 16, 2)}Hand to Gravit</button>` +
  `<button type="button" class="${cls('btn', watched && 'mk-on')}" data-action="toggleWatch" data-id="${esc(id)}" aria-pressed="${watched}">${icon('star', 16, 2)}${watched ? 'Watching' : 'Watch'}</button></div>`;
const aboutHtml = (conversations, asset, now) => mentionsOf(conversations, asset).map(c => `<a class="mk-line" href="#/messages/${esc(c.id)}" data-action="open" data-id="${esc(c.id)}"><span class="mk-mark">→</span>` +
  `<div class="mk-line-b"><div class="mk-t1">${esc(c.title)}</div>${c.updatedAt ? `<div class="mk-t2">${esc(rowTime(c.updatedAt, now))}</div>` : ''}</div></a>`);

// a part of the page as its read allows (the view's `reads`): Loading… until that read has answered, and once it has failed
// before any answer the Account's sentence over <unavailable>; after an answer its lines, or <none> — a later failure's sentence
// over the lines kept
function partBody(r, lines, none, unavailable) {
  const said = r.failed ? note(r.message) : '';
  if (!r.answered) return `${said}${empty(r.failed ? unavailable : 'Loading…')}`;
  return `${said}${lines.length ? feed(lines) : none ? empty(none) : ''}`;
}

/** A market's page, or '' for an id no read lists (the screen then draws the table): an Account key's from its reads, a cn:
 *  id's from the face's own quote. */
export function marketPage(id, state, now) {
  if (isAccountKey(id)) {
    const view = pageOf(state.markets, state.account, id, now);
    return view ? accountPage(id, view, state, now) : '';
  }
  const asset = faceAssetOf(state.markets, id);
  return asset?.market === 'cn' ? cnPage(asset, state, now) : '';
}

// a statement line done: its mark is a tick
const DONE = new Set(['filled', 'settled']);

function accountPage(id, view, state, now) {
  const { priced } = view;
  const unit = priced.unit;
  const closes = view.closesAt ? `closes ${fmtDate(Date.parse(view.closesAt))}` : '';
  const who = `<div class="mk-who">${mkAv(view.tile, 'lg')}<div><h1 class="head-title">${esc(view.name)}</h1>` +
    `<span class="mk-sub">${esc([...view.sub, closes].filter(Boolean).join(' · '))}${view.item.pastEnd === true ? ` ${tag('Closed')}` : ''}</span></div></div>`;

  // the price it shows, its 24 hours and its volume the explore read's; where the price is from, with its age, once, under it, as
  // the Account's page says it; an event's outcomes under the price
  const moved = (unit === 'cents' ? priced.change24h : priced.changePct) !== null;
  const outcomes = view.outcomes.map(o => `<span class="mk-out">${esc(`${o.label} ${priceWord(o.cents, 'cents')}`)}</span>`);
  const facts = [['24h volume', volumeWordOf(priced)], ['Venues', String(view.legs.length)]];
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(priceWord(view.price, unit))}</span>${moved ? `${moveHtml(priced)}<span class="mk-basis">24h</span>` : ''}</div>` +
    `${outcomes.length ? `<div class="mk-outs">${outcomes.join('')}</div>` : ''}${view.sourceWord ? `<p class="mk-asof">${esc(view.sourceWord)}</p>` : ''}` +
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

  // what is held of it, what is working on it and what was stated for it, each as far as its own read has got
  const held = [
    ...view.held.assets.map(a => line('·', esc(`${[qtyWord(a.amount), a.asset].filter(Boolean).join(' ')} · ${money(a.usd)}`))),
    ...view.held.positions.map(p => line('·', `${esc(`${p.venueName || p.venue} · ${[p.side, qtyWord(p.qty), p.symbol].filter(Boolean).join(' ')} · `)}` +
      `<span class="${tone(p.unrealizedUsd)}">${esc(signedMoney(p.unrealizedUsd))}</span>${p.paper ? ` ${tag('Paper')}` : ''}`)),
  ];
  right.push(section('You hold', partBody(view.reads.held, held, 'You don’t hold any.', 'Holdings unavailable')));
  const orders = view.orders.map(o => line('·', esc(orderWords(o))));
  // nothing working once the page has answered: no section; a page the face does not recognise: unreadable, never loading
  if (orders.length || !view.reads.orders.answered || view.reads.orders.failed) {
    right.push(section('Open orders', partBody(view.reads.orders, orders, '', view.reads.orders.unreadable ? 'Account unreadable' : 'Account unavailable')));
  }
  const about = aboutHtml(state.conversations, view.about, now);
  if (about.length) right.push(section('Gravit on it', feed(about)));
  const stated = view.lines.map(l => line(DONE.has(l.status) ? '✓' : '·', esc([when(l.at, now), l.description, money(l.amountUsd)].filter(Boolean).join(' · ')),
    esc([l.status, l.by].filter(Boolean).join(' · ')), DONE.has(l.status) ? 'ok' : ''));
  right.push(section('On the statement', partBody(view.reads.lines, stated, 'Nothing on the statement about it yet.', 'Statement unavailable'),
    '<button type="button" class="link mk-link" data-action="openStatement">Open the Statement →</button>'));
  return pageHtml(who, keysHtml(id, view.watched), top, left, right);
}

// an A share's page, the face's own: its quote against the previous close, its facts, the conversations that name it
function cnPage(asset, state, now) {
  const m = state.markets;
  const quote = own(m.quotes, asset.id) ?? own(m.hitQuotes, asset.id);
  const watched = records(m.watchlist).some(a => a.id === asset.id);
  const sub = ['A-share', asset.symbol, asset.exchange].filter(Boolean).join(' · ');
  const who = `<div class="mk-who">${mkAv(asset.symbol, 'lg')}<div><h1 class="head-title">${esc(asset.name || asset.symbol)}</h1><span class="mk-sub">${esc(sub)}</span></div></div>`;
  const priced = number(quote?.price) !== null;
  const asOf = priced && quote.as_of && when(quote.as_of, now) ? `as of ${when(quote.as_of, now)} · ` : '';
  const facts = [['Previous close', price(quote?.prev_close, asset.currency)], ['Volume', volumeWord(asset, quote)], ['Source', sourceWord(quote ?? { market: asset.market })]];
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(price(quote?.price, asset.currency))}</span>` +
    `${priced ? `${chgHtml(number(quote.change_pct))}<span class="mk-basis">${esc(basisWord(quote))}</span>` : ''}</div>` +
    `<p class="mk-asof">${esc(asOf + quoteWord(quote, m.providers, asset.market))}</p>` +
    `<dl class="mk-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  const about = aboutHtml(state.conversations, asset, now);
  return pageHtml(who, keysHtml(asset.id, watched), top, [], about.length ? [section('Gravit on it', feed(about))] : []);
}
