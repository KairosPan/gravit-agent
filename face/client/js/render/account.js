// face/client/js/render/account.js — Account on the face (spec 2026-10-19 §7 Stage 2): the paper account /data/account.json
// reads, as Portfolio (net worth, today, the allocation bar, holdings, orders by bucket) and Venues (the Alpaca row, the
// quote providers); the Statement drawer with its CSV; the Settings drawer. Read only: the agent orders behind its gates.
import { esc, cls } from '../html.js';
import { fmtClock, fmtDate, sameDay } from '../time.js';
import { money, signedMoney, pct, sign } from '../wire/account-model.js';
import { price } from '../wire/market-model.js';
import { portfolioOf, orderLine, statementOf, venueOf } from '../host/account-view.js';
import { providerWord } from '../host/market-view.js';
import { chip } from './thread.js';
import { seg, segLinks } from './controls.js';

const BUCKETS = [['working', 'Working'], ['filled', 'Filled'], ['closed', 'Closed'], ['other', 'Other']];
const KEYS = { env: 'Keys · env', file: 'Keys · file', 'project-env': 'Keys · project-env', 'user-env': 'Keys · user-env', none: 'No keys', unknown: 'Keys unknown' };
const ORDERS = { on: 'Order tools on', off: 'Order tools off', unknown: 'Order tools unknown' };

const box = (inner, label) => `<section class="cardbox"${label ? ` aria-label="${label}"` : ''}>${inner}</section>`;
const note = text => `<p class="acct-note">${esc(text)}</p>`;
const tone = value => ({ pos: 'up', neg: 'down' })[sign(value)] ?? 'flat';
const qtyWord = n => (n === null ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 }));
const when = (at, now) => { const t = Date.parse(at); return Number.isNaN(t) ? '' : sameDay(t, now) ? fmtClock(t) : `${fmtDate(t)} ${fmtClock(t)}`; };
// a holding in its own unit: shares of a stock, the base of a coin, a bare count for anything else
function heldWord(h) {
  if (h.id?.startsWith('us:')) return `${qtyWord(h.qty)} share${h.qty === 1 ? '' : 's'}`;
  if (h.id?.startsWith('crypto:')) return `${qtyWord(h.qty)} ${h.id.slice('crypto:'.length).split('/')[0]}`;
  return qtyWord(h.qty);
}

function portfolio(state, now) {
  const a = state.account;
  const data = a.data;
  if (!data) return note(a.status === 'error' ? 'Account unavailable' : 'Loading…') + (a.status === 'error' ? '<div class="btn-row"><button type="button" class="btn-sm" data-action="refreshAccount">Retry</button></div>' : '');
  const p = portfolioOf(data);
  // the keyless face says so in the face's own words; any other unreadable answer is unavailable, its text never drawn
  if (!p.available) return note(data.ok === true ? 'No APCA keys in the environment' : 'Account unavailable');
  const cur = p.currency;
  const stale = data.stale === true ? note(`As of ${when(data.generated_at, now) || 'earlier'} · stale`) : '';
  const bar = p.alloc.length
    ? `<div class="alloc-bar">${p.alloc.map(x => `<span class="alloc-seg alloc-${x.token}" style="flex:${x.pct.toFixed(2)}"></span>`).join('')}</div>` +
      `<div class="alloc-legend">${p.alloc.map(x => `<span>${esc(x.label)} ${Math.round(x.pct)}%</span>`).join('')}</div>`
    : '';
  const holdings = p.holdings.map(h => `<div class="holding"><span>${h.id ? `<a class="ticker" href="#/markets/${esc(h.id)}">${esc(h.symbol)}</a>` : `<span class="ticker">${esc(h.symbol)}</span>`}` +
    `<span class="dim"> · ${esc(heldWord(h))}</span></span><span class="num">${esc(money(h.value, cur))}</span><span class="${tone(h.changeToday)}">${esc(pct(h.changeToday))}</span></div>`).join('');
  const worth = box(`<div class="label">Net worth</div><div class="networth">${esc(money(p.netWorth, cur))}</div>` +
    `<div class="delta"><span class="${tone(p.today)}">${esc(signedMoney(p.today, cur))} · ${esc(pct(p.todayPct))}</span><span class="dim">today</span></div>${stale}${bar}` +
    `${holdings ? `<div class="holdings">${holdings}</div>` : ''}<div class="btn-row"><button type="button" class="btn-sm" data-action="openStatement">Statement</button></div>`, 'Portfolio');
  const groups = BUCKETS.filter(([k]) => p.orders[k].length)
    .map(([k, label]) => `<div class="acct-orders"><div class="dsec-label">${label}</div>${p.orders[k].map(o => `<div class="order-row">${esc(orderLine(o))}</div>`).join('')}</div>`).join('');
  const orders = box(`<div class="cardbox-title">Orders</div>${groups || note('No orders')}`, 'Orders');
  return `<div class="cards">${worth}${orders}</div>`;
}

function venues(state) {
  const a = state.account;
  const v = venueOf(a.data, a.creds, a.tools);
  const facts = [v.host, KEYS[v.keys], ORDERS[v.orders]].filter(Boolean).join(' · ');
  const alpaca = `<div class="venue"><span><b>Alpaca${v.mode ? ` ${v.mode.toLowerCase()}` : ''}</b><br><span class="dim">${esc(facts)}</span></span></div>`;
  const quotes = (a.probe ?? []).map(p => `<div class="venue"><span>${esc(providerWord(p))}</span></div>`).join('');
  return `<div class="cards">${box(`<div class="cardbox-title">Venues</div><div class="venues">${alpaca}</div>` +
    `${quotes ? `<div class="cardbox-title">Quotes</div><div class="venues">${quotes}</div>` : ''}`, 'Venues')}</div>`;
}

// the Statement: the filled orders among the 50 most recent, newest first, and their CSV
export function renderStatement(state, now) {
  const p = portfolioOf(state.account.data);
  const rows = statementOf(state.account.data).map(r => `<div class="activity-row"><span class="dim">${esc(when(r.at, now))}</span>` +
    `<span class="activity-text">${r.side === 'sell' ? 'Sell' : 'Buy'} ${esc(qtyWord(r.qty))} ${esc(r.symbol)} · ${esc(price(r.price, p.currency))}</span>` +
    `<span class="num">${esc(money(r.amount, p.currency))}</span></div>`).join('');
  return `<aside class="drawer" aria-label="Statement"><div class="drawer-head"><h2>Statement</h2><button type="button" class="close-key" data-action="closeStatement" aria-label="Close">×</button></div>` +
    `<div class="drawer-body">${note('The 50 most recent orders')}` +
    `${rows ? `<div class="activity">${rows}</div><div class="btn-row"><button type="button" class="btn-sm" data-action="exportStatement">Export CSV</button></div>` : note('No filled orders')}</div></aside>`;
}

export function renderSettings(state) {
  const theme = { cream: 'Cream', black: 'Black' }[state.theme] ?? 'System';
  return `<aside class="drawer" aria-label="Settings"><div class="drawer-head"><h2>Settings</h2><button type="button" class="close-key" data-action="closeSettings" aria-label="Close">×</button></div><div class="drawer-body">` +
    `<div class="dsec"><div class="dsec-label">Theme</div>${seg(['Cream', 'Black', 'System'], theme, 'setTheme')}</div></div></aside>`;
}

// the screen; app.js adds the Settings drawer as it does on every screen
export function renderAccountScreen(state, now) {
  const tab = state.route.tab === 'venues' ? 'venues' : 'portfolio';
  const a = state.account;
  const mode = venueOf(a.data, null, null).mode;
  const head = `<div class="acct-head"><h1 class="head-title">Account</h1>${mode ? chip(mode, 'grey') : ''}<span class="spacer"></span>` +
    `<button type="button" class="pill" data-action="refreshAccount">Refresh</button><button type="button" class="pill" data-action="openSettings">Settings</button></div>`;
  const tabs = segLinks([['Portfolio', '#/account/portfolio', 'portfolio'], ['Venues', '#/account/venues', 'venues']], tab);
  const statement = a.statementOpen && !state.settingsOpen;
  return `<main class="${cls('main', 'acct', (state.settingsOpen || statement) && 'with-drawer')}">${head}${tabs}${tab === 'venues' ? venues(state) : portfolio(state, now)}` +
    `${statement ? renderStatement(state, now) : ''}</main>`;
}
