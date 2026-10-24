// face/client/js/render/account.js — Account on the face (spec 2026-10-22 §6.2): the Account's own page and reads through
// the face's proxy, in four tabs — Portfolio (the two figures, the change for the range and its curve, Assets, Positions,
// Open orders), Venues (each venue with its health and what it does, its Details drawer; the A-share quotes line; the seat
// box), Agents (Gravit's seat first, then the Account's agents and the keys knocking), Cards (what waits for the owner, and
// the agents' asks) — the Statement drawer, the Settings drawer with Devices; the owner device's line under
// the head (render/owner.js). Every figure and word is a view's (host/account-view.js); this module draws them.
import { esc, attrs, cls } from '../html.js';
import { fmtClock, fmtDate, sameDay } from '../time.js';
import { money, signedMoney, sign } from '../wire/account-model.js';
import { price } from '../wire/market-model.js';
import {
  pageOk, headOf, worthOf, changeOf, assetsOf, positionsOf, openOrdersOf, missingWords, statementLinesOf,
  venuesOf, agentsOf, cardsOf, asksOf, requestsOf, seatWords,
} from '../host/account-view.js';
import { providerWord } from '../host/market-view.js';
import { chip } from './thread.js';
import { seg, segLinks, sec } from './controls.js';
import { curveSvg } from './chart.js';
import { renderDeviceLine, renderDevices } from './owner.js';

const TABS = [['portfolio', 'Portfolio'], ['venues', 'Venues'], ['agents', 'Agents'], ['cards', 'Cards']];
// the curve's ranges, the Account's own names and their words
const RANGES = [['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['all', 'All']];
// a venue's Details facts, each under its label
const DETAILS = [['noTradeBecause', 'No trading'], ['restricted', 'Restricted'], ['notServed', 'Not served'], ['closeOnly', 'Close only'], ['watchOnly', 'Watch only'], ['keyFile', 'Key file']];

const box = (inner, label) => `<section class="cardbox"${label ? ` aria-label="${label}"` : ''}>${inner}</section>`;
const note = text => `<p class="acct-note">${esc(text)}</p>`;
const title = text => `<div class="cardbox-title">${esc(text)}</div>`;
const tone = value => ({ pos: 'up', neg: 'down' })[sign(value)] ?? 'flat';
const retry = '<button type="button" class="btn-sm" data-action="refreshAccount">Retry</button>';
// a quantity or a price as the Account gives it, grouped (0.707, 63,226.6); nothing given is —
const numWord = n => (n === null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 }));
// the Account's percents are percents already (0.72 is 0.72 %), never a fraction to scale; nothing given is —
const pctWord = v => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(2)} %`);
const capital = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const when = (at, now) => { const t = Date.parse(at); return Number.isNaN(t) ? '' : sameDay(t, now) ? fmtClock(t) : `${fmtDate(t)} ${fmtClock(t)}`; };
const dateWord = at => { const t = Date.parse(at); return Number.isNaN(t) ? '' : fmtDate(t); };
// a row's words: the first bold (a chip beside it), each line under it dim, blanks left out
const lines = (head, dims = [], chipText = '') => `<b>${esc(head)}</b>${chipText ? ` ${chip(chipText)}` : ''}${dims.filter(Boolean).map(d => `<br><span class="dim">${esc(d)}</span>`).join('')}`;
// a table: its head, then each row's cells as HTML, every column but the first a figure, right-aligned
const table = (head, rows) => `<div class="acct-wrap"><table class="acct-t"><thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>` +
  `<tbody>${rows.map(cells => `<tr>${cells.map((c, i) => `<td${i ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
// a read beside the page, in a word where its rows would be: not read yet, failed before any answer, or read and empty
const readNote = (read, failed, none) => note(read.data === null ? (read.status === 'error' ? failed : 'Loading…') : none);

// the page's state where its figures would be: still loading, unavailable (with Retry), or an answer the face does not
// recognise — never a number from it; null when the page is the Account's
function pageNote(a) {
  if (pageOk(a.data)) return null;
  if (a.data) return note('Account unreadable');
  return a.status === 'error' ? `${note('Account unavailable')}<div class="btn-row">${retry}</div>` : note('Loading…');
}

function head(state) {
  const h = headOf(state.account.data);
  return `<div class="acct-head"><h1 class="head-title">Account</h1>${h.mode ? chip(h.mode) : ''}${h.writes ? chip(h.writes) : ''}<span class="spacer"></span>` +
    `<button type="button" class="pill" data-action="refreshAccount">Refresh</button><button type="button" class="pill" data-action="openSettings">Settings</button></div>` +
    renderDeviceLine(state);
}

// the tabs, the Cards tab counting what waits
function tabs(state, tab) {
  const waiting = cardsOf(state.account.data).reduce((n, g) => n + g.cards.length, 0);
  return segLinks(TABS.map(([id, label]) => [id === 'cards' && waiting ? `${label} · ${waiting}` : label, `#/account/${id}`, id]), tab);
}

// ── Portfolio ──

// the change for the range in one run: the change (— when the Account gave none), the curve's own range word (a read for a
// range the screen has since left says so), partial when the Account says it is, since when for All; and on the paper curve,
// what the paper book made since its start and whether the Account rebuilt it from the book
function changeLine(a, paperLeads) {
  const c = changeOf(a.history.data);
  const range = RANGES.find(([id]) => id === a.history.data?.range) ?? RANGES.find(([id]) => id === a.history.range);
  const since = range?.[0] === 'all' && c.first ? dateWord(c.first) : '';
  const words = [
    c.usd === null ? '—' : `${signedMoney(c.usd)} · ${pctWord(c.pct)}`, range?.[1], c.partial ? 'partial' : '', since ? `since ${since}` : '',
    paperLeads && c.sinceStartUsd !== null ? `since start ${signedMoney(c.sinceStartUsd)}` : '', paperLeads && c.rebuilt ? 'rebuilt' : '',
  ].filter(Boolean).join(' · ');
  return `<div class="delta"><span class="${tone(c.usd)}">${esc(words)}</span></div>`;
}

// Assets and Positions are the leading lens's read: the paper book's (holdings?cost=1&paper=1) while Paper leads, else real
// money's (holdings?cost=1). When that read refused, the Account's sentence: where Holdings unavailable would be before any
// answer (the fixed word only when there is none), over the rows kept after one
function assetsBox(lens) {
  const rows = assetsOf(lens.data).map(r => [
    lines(r.asset, r.venues.map(v => [v.venueName || v.venue, numWord(v.amount), v.stale ? 'stale' : ''].filter(Boolean).join(' · '))),
    esc(numWord(r.amount)), esc(price(r.price)), `<span class="${tone(r.changePct24h)}">${esc(pctWord(r.changePct24h))}</span>`, esc(money(r.usd)),
  ]);
  const said = lens.status === 'error' && lens.message ? note(lens.message) : '';
  const body = rows.length ? table(['Asset', 'Amount', 'Price', '24h', 'Value'], rows) : said && lens.data === null ? '' : readNote(lens, 'Holdings unavailable', 'No assets');
  return box(`${title('Assets')}${said}${body}`, 'Assets');
}

function positionsBox(lens) {
  const rows = positionsOf(lens.data).map(p => [
    lines(p.symbol, [[p.venueName || p.venue, p.side, numWord(p.qty)].filter(Boolean).join(' · ')], p.paper ? 'Paper' : ''),
    esc(money(p.usd)), esc(price(p.entryPrice)), esc(price(p.markPrice)), `<span class="${tone(p.unrealizedUsd)}">${esc(signedMoney(p.unrealizedUsd))}</span>`,
  ]);
  return rows.length ? box(`${title('Positions')}${table(['Position', 'Value', 'Entry', 'Mark', 'P&L'], rows)}`, 'Positions') : '';
}

// an order in a line: `Stand-in Exchange · Buy 0.5 SOL/USDT · limit 142.44 · open · You` (a market's page lists its own so)
export function orderWords(o) {
  const type = o.type.replace(/_/g, ' ');
  const size = [capital(o.side), o.qty === null ? '' : numWord(o.qty), o.symbol].filter(Boolean).join(' ');
  return [o.venueName || o.venue, size, type && o.limitPrice !== null ? `${type} ${numWord(o.limitPrice)}` : type, o.status, o.who].filter(Boolean).join(' · ');
}

function ordersBox(a) {
  const open = openOrdersOf(a.data).map(o => `<div class="order-row">${esc(orderWords(o))}</div>`).join('');
  return box(`${title('Open orders')}${open ? `<div class="acct-orders">${open}</div>` : note('No open orders')}`, 'Open orders');
}

function portfolio(state, now) {
  const a = state.account;
  const unread = pageNote(a);
  if (unread !== null) return unread;
  const w = worthOf(a.data, a.holdings.data, a.paper.data);
  const figure = (f, size) => `<div><div class="label">${esc(f.label)}</div><div class="${size}">${esc(money(f.usd))}</div></div>`;
  const figures = `<div class="acct-figures">${figure(w.lead, 'networth')}${w.second ? figure(w.second, 'acct-second') : ''}</div>`;
  // the venues a read could not reach, the paper lens's with them, each once
  const gone = [...new Set([...missingWords(a.holdings.data?.missing), ...missingWords(a.paper.data?.missing)])];
  // a page the Account says is stale, or a read that failed after a good one: the last good figures, stamped with the page's time
  const failed = a.status === 'error';
  const stale = failed || a.data.stale === true ? note(`As of ${when(a.data.now, now) || 'earlier'} · stale`) : '';
  const worth = box(`${figures}${changeLine(a, w.paperLeads)}${seg(RANGES.map(([id, word]) => [word, id]), a.history.range, 'setHistoryRange')}` +
    `${curveSvg(a.history.data?.points, { currency: 'USD', label: w.lead.label })}${gone.length ? note(gone.join(' · ')) : ''}${stale}` +
    `<div class="btn-row">${failed ? retry : ''}<button type="button" class="btn-sm" data-action="openStatement">Statement</button></div>`, 'Portfolio');
  const lens = w.paperLeads ? a.paper : a.holdings;
  return `<div class="cards">${worth}${assetsBox(lens)}${positionsBox(lens)}${ordersBox(a)}</div>`;
}

// ── Venues ──

function venueRow(v, now) {
  const since = v.health === 'not-answering' ? when(v.since, now) : '';
  const health = since ? `${v.healthWords} since ${since}` : v.healthWords;
  const stale = v.stale === true ? 'stale' : typeof v.stale === 'string' ? v.stale : '';
  const facts = [v.usd === null ? '' : money(v.usd), v.frontLine, v.what].filter(Boolean).join(' · ');
  return `<div class="venue"><span>${lines(v.name || v.id, [facts, [health, ...v.does, stale].filter(Boolean).join(' · ')], v.paper ? 'Paper' : '')}</span>` +
    `<button type="button" class="btn-sm" data-action="openVenueDetails"${attrs({ 'data-id': v.id })}>Details</button></div>`;
}

// a venue's Details: what it holds there and the Account's facts about it, each under its label — the key file by its path,
// never what is in it
function venueDetails(v) {
  const d = v.details;
  const held = d.holdings.map(h => [h.asset, numWord(h.amount), money(h.usd)].filter(Boolean).join(' · '));
  const body = (held.length ? sec('Holdings', held) : '') + DETAILS.filter(([key]) => d[key]).map(([key, label]) => sec(label, [d[key]])).join('');
  return `<aside class="drawer" aria-label="Venue details"><div class="drawer-head"><h2>${esc(v.name || v.id)}</h2><button type="button" class="close-key" data-action="closeVenueDetails" aria-label="Close">×</button></div>` +
    `<div class="drawer-body">${body || note('No details')}</div></aside>`;
}

function venues(state, now) {
  const a = state.account;
  const rows = venuesOf(a.data).map(v => venueRow(v, now)).join('');
  const list = pageNote(a) ?? (rows ? `<div class="venues">${rows}</div>` : note('No venues'));
  // of the face's own quote providers only the A-share one is still the screens' (the one kind the face quotes)
  const cn = (Array.isArray(state.markets?.providers) ? state.markets.providers : []).filter(p => p?.market === 'cn');
  const quotes = cn.length ? `<div class="label">A-share quotes</div><div class="venues">${cn.map(p => `<div class="venue"><span>${esc(providerWord(p))}</span></div>`).join('')}</div>` : '';
  return `<div class="cards">${box(`${title('Venues')}${list}${quotes}`, 'Venues')}${seatBox(state, now)}</div>`;
}

// the Account seat's standing (spec 2026-10-20 §6.3): the service with the Account's own mode and writes, the seat and its
// limits, the venues with the paper ones marked, the cards waiting on the Account page — and the way there, the only place a
// card is signed. Its words are the Account's; the stamp is when the face answered.
function seatBox(state, now) {
  const s = state.seat;
  const w = seatWords(s.data);
  const row = (title, dims = [], chipText = '') => `<div class="venue"><span><b>${esc(title)}</b>${chipText ? ` ${chip(chipText)}` : ''}` +
    `${dims.filter(Boolean).map(d => `<br><span class="dim">${esc(d)}</span>`).join('')}</span></div>`;
  let body;
  if (!s.data) body = note(s.status === 'error' ? 'Seat unavailable' : 'Loading…');
  else if (!w.service) body = note('Seat unavailable');
  else {
    const rows = [row(w.service, [[w.mode, w.writes].filter(Boolean).join(' · ')])];
    if (w.seat) rows.push(row(w.seat, w.limits));
    for (const v of w.venues) rows.push(row(v.name, [[v.usd, v.note].filter(Boolean).join(' · ')], v.paper ? 'Paper' : ''));
    // the view's own stamp — when the seat route answered, the Account's page it reduced kept up to 15 s by the proxy's reader —
    // else, for an unreachable answer, which carries none, when this page's read landed
    const read = typeof s.at === 'number' ? new Date(s.at).toISOString() : undefined;
    const stamp = `As of ${when(s.data.asOf ?? read, now) || 'earlier'}${s.status === 'error' ? ' · stale' : ''}`;
    body = `<div class="venues">${rows.join('')}</div>${note([w.cards, stamp].filter(Boolean).join(' · '))}`;
  }
  const keys = `<div class="btn-row">${w.url ? `<a class="btn-sm" href="${esc(w.url)}" target="_blank" rel="noopener">Open the Account page</a>` : ''}` +
    `<button type="button" class="btn-sm" data-action="refreshAccount">Refresh</button></div>`;
  return box(`<div class="cardbox-title">Account seat</div>${body}${keys}`, 'Account seat');
}

// ── Agents ──

// the cards an agent has waiting and its open orders; a count the Account has not given (its agents not read) is —
const countsOf = r => `Cards ${r.cards === null ? '—' : r.cards} · Open orders ${r.orders === null ? '—' : r.orders}`;

function agentsTab(state, now) {
  const a = state.account;
  const rows = agentsOf(a.agents.data, state.seat.data).map(r => `<div class="venue"><span>${r.gravit
    ? lines(r.standing, [...r.limits, countsOf(r)])
    : lines(r.name || 'An agent', [[r.status, dateWord(r.validUntil) ? `until ${dateWord(r.validUntil)}` : ''].filter(Boolean).join(' · '), ...r.limits, countsOf(r)])}</span></div>`).join('');
  const status = a.agents.data === null ? note(a.agents.status === 'error' ? 'Agents unavailable' : 'Loading…') : rows ? '' : note('No agents');
  const knocking = requestsOf(a.data).map(q => `<div class="venue"><span>${lines(q.name || 'An agent', [[q.address, when(q.at, now)].filter(Boolean).join(' · ')])}</span></div>`).join('');
  return `<div class="cards">${box(`${title('Agents')}${rows ? `<div class="venues">${rows}</div>` : ''}${status}` +
    `${knocking ? `<div class="label">Knocking</div><div class="venues">${knocking}</div>` : ''}`, 'Agents')}</div>`;
}

// ── Cards ──

// a card: why the agent asks, its value and the time to answer by, and What it asks — every field the owner signs, as the
// Account sends it
function cardRow(c, now) {
  const by = when(c.expiresAt, now);
  const shown = c.shown.map(f => `<div class="dsec-line">${esc(`${f.name}: ${f.value}`)}</div>`).join('');
  return `<div class="venue"><div>${lines(c.reason, [[c.usd === null ? '' : money(c.usd), by ? `answer by ${by}` : ''].filter(Boolean).join(' · ')])}` +
    `${shown ? `<details${attrs({ id: `shown-${c.id}`, class: 'acct-shown' })}><summary>What it asks</summary>${shown}</details>` : ''}</div></div>`;
}

function cardsTab(state, now) {
  const a = state.account;
  const unread = pageNote(a);
  if (unread !== null) return unread;
  const groups = cardsOf(a.data).map(g => `<div class="dsec-label">${esc(g.agentName)}</div><div class="venues">${g.cards.map(c => cardRow(c, now)).join('')}</div>`).join('');
  const asks = asksOf(a.data).map(k => `<div class="order-row">${esc([k.agentName, k.text, k.kind].filter(Boolean).join(' · '))}</div>`).join('');
  return `<div class="cards">${box(`${title('Waiting for you')}${groups || note('Nothing waiting')}`, 'Cards')}` +
    `${asks ? box(`${title('Asks')}<div class="acct-orders">${asks}</div>`, 'Asks') : ''}</div>`;
}

// ── the drawers ──

// the Statement: the Account's lines newest first, each with who it was by, its status in the Account's word and its fee
// when it had one, and their CSV; the Account's sentence over them when its last read refused
export function renderStatement(state, now) {
  const st = state.account.statement;
  const rows = statementLinesOf(st.data).map(l => {
    const facts = [l.by, l.status, l.feeUsd === null ? '' : `fee ${money(l.feeUsd)}`].filter(Boolean).join(' · ');
    return `<div class="activity-row"><span class="dim">${esc(when(l.at, now))}</span>` +
      `<span class="activity-text">${esc(l.description)}${facts ? `<br><span class="dim">${esc(facts)}</span>` : ''}</span><span class="num">${esc(money(l.amountUsd))}</span></div>`;
  }).join('');
  const said = st.status === 'error' && st.message ? note(st.message) : '';
  const body = rows ? `<div class="activity">${rows}</div><div class="btn-row"><button type="button" class="btn-sm" data-action="exportStatement">Export CSV</button></div>`
    : readNote(st, 'Statement unavailable', 'No statement lines yet');
  return `<aside class="drawer" aria-label="Statement"><div class="drawer-head"><h2>Statement</h2><button type="button" class="close-key" data-action="closeStatement" aria-label="Close">×</button></div>` +
    `<div class="drawer-body">${said}${body}</div></aside>`;
}

export function renderSettings(state) {
  const theme = { cream: 'Cream', black: 'Black' }[state.theme] ?? 'System';
  return `<aside class="drawer" aria-label="Settings"><div class="drawer-head"><h2>Settings</h2><button type="button" class="close-key" data-action="closeSettings" aria-label="Close">×</button></div><div class="drawer-body">` +
    `<div class="dsec"><div class="dsec-label">Theme</div>${seg(['Cream', 'Black', 'System'], theme, 'setTheme')}</div>${renderDevices(state)}</div></aside>`;
}

// the screen: the head, the Account's sentence when it refused, the tabs, the tab, and its drawer; app.js adds the Settings
// drawer as it does on every screen
export function renderAccountScreen(state, now) {
  const a = state.account;
  const tab = TABS.some(([id]) => id === state.route.tab) ? state.route.tab : 'portfolio';
  const statement = a.statementOpen && !state.settingsOpen;
  const venue = statement || state.settingsOpen || !a.detailsVenue ? null : venuesOf(a.data).find(v => v.id === a.detailsVenue) ?? null;
  const body = tab === 'venues' ? venues(state, now) : tab === 'agents' ? agentsTab(state, now) : tab === 'cards' ? cardsTab(state, now) : portfolio(state, now);
  return `<main class="${cls('main', 'acct', (state.settingsOpen || statement || venue) && 'with-drawer')}">${head(state)}${a.message ? note(a.message) : ''}${tabs(state, tab)}${body}` +
    `${statement ? renderStatement(state, now) : ''}${venue ? venueDetails(venue) : ''}</main>`;
}
