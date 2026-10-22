// face/client/js/render/markets.js — Markets on the face (spec 2026-10-22 §6.1): the Account's markets in one table, by its
// tabs, with its sorts and its search — each row's price by kind and where the price is from, in the Account's own words —
// beside the face's own A-share (cn:) rows, quoted by the face's wire; and a market's page (#/markets/<key>) from the Account's
// reads: its price and 24 hours, its facts, its price history for the range chosen, its lines across venues, what is held,
// working and stated for it, the conversations that name it. A cn: page is the face's own quote, as before. Every figure and
// word is a view's (host/market-view.js); this module draws them. No Buy, no Sell, no Trade: the hand order is stage 2.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { chgHtml } from '../market-fmt.js';
import { fmtClock, fmtDate, rowTime, sameDay } from '../time.js';
import { price, number } from '../wire/market-model.js';
import { money, signedMoney, sign } from '../wire/account-model.js';
import { pageOk } from '../host/account-view.js';
import { seg } from './controls.js';
import { candlesSvg } from './chart.js';
import { orderWords } from './account.js';
import {
  ACCOUNT_TABS, ACCOUNT_SORTS, CANDLE_RANGES, isAccountKey, tabsOf, rowsOf, pageOf, priceOf, followOf, faceAssetOf, mentionsOf,
  quoteWord, connectionWord, watchWord, volumeWord, basisWord, sourceWord,
} from '../host/market-view.js';

const EM = '—';
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
// a word the Account gives, or none
const text = v => (typeof v === 'string' ? v : '');
// a record's own entry, never one it inherits
const own = (o, k) => (isRecord(o) && typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined);
const note = text => (text ? `<p class="mk-note">${esc(text)}</p>` : '');
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

// ---- a price, its 24 hours and its volume, as each market's unit says them

// a price in the market's unit: an event's in cents (62¢, 62.5¢), an A share's in yuan, anything else in dollars; nothing is —
function priceWord(v, unit) {
  if (v === null || v === undefined) return EM;
  return unit === 'cents' ? `${Number(v.toFixed(1))}¢` : price(v, unit === 'cny' ? 'CNY' : 'USD');
}
// a price the Account gives in dollars — a quote's, a line's, an outcome's — in the market's unit: an event's in cents, by
// priceOf's own rule
const inUnit = (v, unit) => (unit === 'cents' ? priceOf({ kind: 'event', price: v }).price : number(v));
// a market's price now: the latest quote at the line it is quoted at (`live`) where that says one, else the explore read's
const nowPrice = (live, p) => inUnit(live?.price ?? null, p.unit) ?? p.price;

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

// a count, short, as the Account's page says it: 1.9B, 787M, 412k, 950 — and 999,960 reads 1M, not 1000k
const UNITS = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
function short(n) {
  for (const [size, unit] of UNITS) {
    if (Math.abs(n) < size * 0.9995) continue;
    const v = n / size;
    return `${Math.abs(v) >= 100 ? v.toFixed(0) : String(Number(v.toFixed(1)))}${unit}`;
  }
  return String(Math.round(n));
}
// a day's volume in its unit: dollars ($1.9B), contracts (412k contracts), shares (2M shares); nothing given is —
function volumeCell(p) {
  if (p.volume === null || p.volume === undefined) return EM;
  if (p.volumeUnit === 'contracts') return `${short(p.volume)} contracts`;
  if (p.volumeUnit === 'shares') return `${short(p.volume)} shares`;
  return `$${short(p.volume)}`;
}

// ---- the table

// the letters of a row's tile, as the Account's page has them: an event's category, an A share's code, else its base or name
const tileOf = r => (r.placeholder || r.notListed ? r.name : r.kind === 'event' ? r.sub || 'Event' : r.asset ? r.asset.symbol : r.base || r.name);

// the star; an old star the Account could not find takes Remove in its place
function starCell(r) {
  if (r.notListed) return `<button type="button" class="mk-clear" data-action="removeAsked" data-id="${esc(r.id)}" aria-label="Remove ${esc(r.name)}">Remove</button>`;
  return `<button type="button" class="mk-star" data-action="toggleWatch" data-id="${esc(r.id)}" aria-pressed="${r.watched === true}" aria-label="${r.watched ? 'Stop watching' : 'Watch'} ${esc(r.name)}">${icon('star', 18, 2)}</button>`;
}

// the tile, the name and under it the sub, Closed past its end, Paper where only a paper account trades it first; a market no
// read lists, and a star the Account could not find, have no page to open
function nameCell(r) {
  const tags = [r.pastEnd ? 'Closed' : '', r.legs.find(l => l.connected)?.paper ? 'Paper' : ''].filter(Boolean).map(tag).join(' ');
  const inner = `${mkAv(tileOf(r))}<span class="mk-nm"><b>${esc(r.name)}</b><span class="mk-sub">${esc(r.sub)}${tags ? ` ${tags}` : ''}</span></span>`;
  return r.placeholder || r.notListed ? `<span class="mk-who">${inner}</span>`
    : `<button type="button" class="mk-name" data-action="openMarket" data-id="${esc(r.id)}">${inner}</button>`;
}

function row(r) {
  return `<tr data-id="${esc(r.id)}"><td>${starCell(r)}</td><td class="mk-c-name">${nameCell(r)}</td>` +
    `<td class="r">${esc(priceWord(nowPrice(r.live, r.priced), r.priced.unit))}</td><td class="r mk-c-chg">${moveHtml(r.priced)}</td>` +
    `<td class="r mk-c-vol">${esc(volumeCell(r.priced))}</td><td class="r mk-c-st"><span class="mk-st">${esc(r.sourceWord)}</span></td></tr>`;
}

function table(rows) {
  const head = '<tr><th scope="col"><span class="sr-only">Watch</span></th><th scope="col" class="mk-c-name">Market</th><th scope="col" class="r">Price</th>' +
    '<th scope="col" class="r mk-c-chg">24h</th><th scope="col" class="r mk-c-vol">Volume</th><th scope="col" class="r mk-c-st">Source</th></tr>';
  return `<section class="cardbox mk-tcard" aria-label="Markets"><div class="mk-wrap"><table class="mk-t"><thead>${head}</thead><tbody>${rows.map(row).join('')}</tbody></table></div></section>`;
}

// the explore read a tab's rows are from: a kind's own once it has answered, else All's; while searching, the search's
const KINDS = new Set(ACCOUNT_TABS.map(([id]) => id).filter(id => id !== 'all'));
const exploreTab = tab => (KINDS.has(tab) ? tab : 'all');
function readOf(m, tab, searching) {
  if (searching) return m.results;
  const mine = own(m.explore, exploreTab(tab));
  return mine?.data ? mine : own(m.explore, 'all');
}

// where the rows would be when there are none: nothing starred; an answer with nothing in it; a read still on its way (the search
// and the face's own for the A shares, while searching); or one that failed before it ever answered
function emptyWord(m, tab, searching) {
  if (tab === 'watching' && !searching) return 'Nothing watched yet';
  const read = readOf(m, tab, searching);
  const busy = searching && m.search?.status === 'loading';
  if (read?.data && !busy) return 'No markets';
  if (!read || read.status !== 'error' || busy) return searching ? 'Searching…' : 'Loading…';
  return searching ? 'Search is unavailable' : 'Markets unavailable';
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
  const rows = rowsOf(m, now);
  // the tabs: the Account's, with its counts once its read has answered; Watching once anything is starred, All results while searching
  const watchlist = records(m.watchlist);
  const counted = Boolean(own(m.explore, 'all')?.data);
  const cnCount = watchlist.filter(a => typeof a.id === 'string' && a.id.startsWith('cn:')).length;
  const tabs = tabsOf(own(m.explore, 'all')?.data, cnCount, { watching: (m.watch?.length ?? 0) > 0 || watchlist.length > 0, searching });
  const tabsHtml = `<div class="mk-tabs" role="group" aria-label="Markets">${tabs.map(t => `<button type="button" class="mk-tab" data-action="mkTab" data-value="${esc(t.id)}" aria-pressed="${t.id === m.tab}">${esc(counted && t.count !== null ? `${t.label} · ${t.count}` : t.label)}</button>`).join('')}</div>`;
  // Closing soonest only where a row closes
  const sorts = ACCOUNT_SORTS.filter(s => s.id !== 'closing' || rows.some(r => r.closeTime));
  const left = searching
    ? `<p class="mk-q">${rows.length} market${rows.length === 1 ? '' : 's'} for “${esc(q)}” <button type="button" class="mk-clear" data-action="mkClear">Clear</button></p>`
    : '<span></span>';
  const bar = `<div class="mk-bar">${left}${rows.length > 1 ? seg(sorts.map(s => [s.label, s.id]), m.sort, 'mkSort') : ''}</div>`;
  // the muted lines: the Account's own sentence when its read refused, the face's wire's state where an A share is drawn, the
  // watchlist's
  const message = (searching ? m.results : own(m.explore, exploreTab(m.tab)))?.message;
  const cnDrawn = rows.some(r => r.source === 'face' && !r.notListed);
  const words = note(message) + (cnDrawn ? note(connectionWord(m.connection)) : '') + note(watchWord(m.watchError));
  const body = rows.length ? table(rows) : `<p class="mk-empty">${esc(emptyWord(m, m.tab, searching))}</p>`;
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

// what a market is, in a word, as the Account's page says it
const KIND_WORDS = { coin: 'Crypto', stock: 'Stock', perp: 'Perpetual', rwa: 'Tokenized asset', event: 'Prediction' };
// an outcome as a person says it: YES → Yes, UP → Up; a named outcome as its venue writes it
const OUTCOMES = { YES: 'Yes', NO: 'No', UP: 'Up', DOWN: 'Down' };
const outcomeWord = label => { const s = typeof label === 'string' ? label : ''; return Object.hasOwn(OUTCOMES, s) ? OUTCOMES[s] : s; };
// a statement line done: its mark is a tick
const DONE = new Set(['filled', 'settled']);

function accountPage(id, view, state, now) {
  const m = state.markets;
  const { item, priced } = view;
  const [name, base, category] = [text(item.name), text(item.base), text(item.category)];
  const unit = priced.unit;
  const event = item.kind === 'event';
  // starred: a key the operator watches, or one an old star of the face's was found as (rowsOf's rule)
  const watched = (Array.isArray(m.watch) && m.watch.includes(id)) || records(m.watchlist).some(a => own(m.asked, a.id) === id);
  const preipo = priced.implied !== null || (Array.isArray(item.tabs) && item.tabs.includes('preipo'));
  const closes = event && typeof item.closeTime === 'string' && !Number.isNaN(Date.parse(item.closeTime)) ? fmtDate(Date.parse(item.closeTime)) : '';
  const sub = (event ? [category, closes ? `closes ${closes}` : ''] : [preipo ? 'Pre-IPO' : own(KIND_WORDS, item.kind), followOf(item)?.symbol])
    .filter(w => typeof w === 'string' && w !== '').join(' · ');
  const who = `<div class="mk-who">${mkAv(event ? category || 'Event' : base || name, 'lg')}<div><h1 class="head-title">${esc(name)}</h1>` +
    `<span class="mk-sub">${esc(sub)}${item.pastEnd === true ? ` ${tag('Closed')}` : ''}</span></div></div>`;

  // the price now, its 24 hours and its volume the explore read's; where it is from, with its age; an event's outcomes under it
  const moved = (event ? priced.change24h : priced.changePct) !== null;
  const outcomes = event ? records(item.outcomes).map(o => `<span class="mk-out">${esc(`${outcomeWord(o.label)} ${priceWord(inUnit(o.price, 'cents'), 'cents')}`)}</span>`) : [];
  const facts = [['24h volume', volumeCell(priced)], ['Venues', String(view.legs.length)], ['Source', view.sourceWord || EM]];
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(priceWord(nowPrice(view.live, priced), unit))}</span>${moved ? `${moveHtml(priced)}<span class="mk-basis">24h</span>` : ''}</div>` +
    `${outcomes.length ? `<div class="mk-outs">${outcomes.join('')}</div>` : ''}${view.sourceWord ? `<p class="mk-asof">${esc(view.sourceWord)}</p>` : ''}` +
    `<dl class="mk-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

  const left = [];
  const right = [];
  // Price history: the Account's ranges, the one kept pressed; the closes once a read for it answered, with the Account's own words
  // under them — Loading… while it reads, No history when it answered with fewer than two closes, nothing before a read
  const chart = own(m.candles, id);
  const current = chart?.status === 'ready' && view.candles !== null && (typeof view.candles.range !== 'string' || view.candles.range === view.range);
  const svg = current ? candlesSvg(view.candles.candles, { unit, range: view.range }) : '';
  const under = chart?.status === 'loading' ? note('Loading…')
    : svg ? note([view.candles.ends, view.candles.note].filter(w => typeof w === 'string' && w.trim() !== '').join(' · '))
      : current ? note('No history') : '';
  left.push(section('Price history', svg + under, seg(CANDLE_RANGES.map(r => [r, r]), view.range, 'setRange', { 'data-id': id })));
  // Across venues: the lines the owner connected, the best marked, Paper where so; a public listing leads to Venues to connect
  const venues = view.legs.map(l => line('·',
    `${esc([l.venueName || l.venue, l.symbol, priceWord(inUnit(l.price, unit), unit)].filter(Boolean).join(' · '))}${l.best ? ` ${tag('Best')}` : ''}${l.paper ? ` ${tag('Paper')}` : ''}`,
    '', '', !l.connected && l.public ? '<a class="link mk-link" href="#/account/venues">Connect to trade</a>' : ''));
  if (venues.length) left.push(section('Across venues', feed(venues)));

  // what is held of it, what is working on it and what was stated for it: once the Account's page is read
  const read = pageOk(state.account?.data);
  if (read) {
    const held = [
      ...view.held.assets.map(a => line('·', esc(`${[qtyWord(a.amount), a.asset].filter(Boolean).join(' ')} · ${money(a.usd)}`))),
      ...view.held.positions.map(p => line('·', `${esc(`${p.venueName || p.venue} · ${[p.side, qtyWord(p.qty), p.symbol].filter(Boolean).join(' ')} · `)}` +
        `<span class="${tone(p.unrealizedUsd)}">${esc(signedMoney(p.unrealizedUsd))}</span>${p.paper ? ` ${tag('Paper')}` : ''}`)),
    ];
    right.push(section('You hold', held.length ? feed(held) : '<p class="mk-empty">You don’t hold any.</p>'));
    const orders = view.orders.map(o => line('·', esc(orderWords(o))));
    if (orders.length) right.push(section('Open orders', feed(orders)));
  }
  const about = aboutHtml(state.conversations, { symbol: base, name }, now);
  if (about.length) right.push(section('Gravit on it', feed(about)));
  if (read) {
    const stated = view.lines.map(l => line(DONE.has(l.status) ? '✓' : '·', esc([when(l.at, now), l.description, money(l.amountUsd)].filter(Boolean).join(' · ')),
      esc([l.status, l.by].filter(Boolean).join(' · ')), DONE.has(l.status) ? 'ok' : ''));
    right.push(section('On the statement', stated.length ? feed(stated) : '<p class="mk-empty">Nothing on the statement about it yet.</p>',
      '<button type="button" class="link mk-link" data-action="openStatement">Open the Statement →</button>'));
  }
  return pageHtml(who, keysHtml(id, watched), top, left, right);
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
