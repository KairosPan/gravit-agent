// face/client/js/render/markets.js — Markets on the face (spec 2026-10-19 §7 Stage 2): the watchlist and the holdings, or
// the search's hits, each with its quote; tabs, the sort seg and one table. A market's page is #/markets/<id>. No Trade,
// no venues, no prediction cards: the face quotes and searches, the agent trades behind its own gates.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { chgHtml } from '../market-fmt.js';
import { fmtClock, fmtDate, rowTime, sameDay } from '../time.js';
import { price, number } from '../wire/market-model.js';
import { money, pct, sign } from '../wire/account-model.js';
import { portfolioOf, statementOf } from '../host/account-view.js';
import { seg } from './controls.js';
import { chartSvg } from './chart.js';
import {
  MARKET_TABS, MARKET_SORTS, marketRows, assetFor, positionId, mentionsOf,
  quoteWord, connectionWord, searchWord, watchWord, volumeWord, basisWord, sourceWord, barsWord,
} from '../host/market-view.js';

const baseOf = asset => (asset.market === 'crypto' ? String(asset.symbol).split('/')[0] : String(asset.symbol));
const nameOf = asset => asset.name || asset.symbol;

// a round letter tile: the symbol, or a coin's base
export function mkAv(asset, size = '') {
  return `<span class="${cls('mk-av', size && `mk-av-${size}`)}" aria-hidden="true">${esc(baseOf(asset).slice(0, 4))}</span>`;
}

function row({ asset, quote, watched, held }) {
  const id = esc(asset.id);
  const sub = [asset.symbol, asset.exchange].filter(Boolean).join(' · ');
  return `<tr data-id="${id}">` +
    `<td><button type="button" class="mk-star" data-action="toggleWatch" data-id="${id}" aria-pressed="${watched}" aria-label="${watched ? 'Stop watching' : 'Watch'} ${esc(asset.symbol)}">${icon('star', 18, 2)}</button></td>` +
    `<td class="mk-c-name"><button type="button" class="mk-name" data-action="openMarket" data-id="${id}">${mkAv(asset)}<span class="mk-nm"><b>${esc(nameOf(asset))}</b>` +
    `<span class="mk-sub">${esc(sub)}${held ? ' <span class="mk-tag">Held</span>' : ''}</span></span></button></td>` +
    `<td class="r">${esc(price(quote?.price, asset.currency))}</td>` +
    `<td class="r mk-c-chg">${chgHtml(number(quote?.change_pct))}</td>` +
    `<td class="r mk-c-vol">${esc(volumeWord(asset, quote))}</td>` +
    `<td class="r mk-c-st"><span class="mk-st">${esc(quoteWord(quote))}</span></td></tr>`;
}

function table(rows) {
  const head = '<tr><th scope="col"><span class="sr-only">Watch</span></th><th scope="col" class="mk-c-name">Market</th><th scope="col" class="r">Price</th>' +
    '<th scope="col" class="r mk-c-chg">Change</th><th scope="col" class="r mk-c-vol">Volume</th><th scope="col" class="r mk-c-st"><span class="sr-only">Quote</span></th></tr>';
  return `<section class="cardbox mk-tcard" aria-label="Markets"><div class="mk-wrap"><table class="mk-t"><thead>${head}</thead><tbody>${rows.map(row).join('')}</tbody></table></div></section>`;
}

const note = text => (text ? `<p class="mk-note">${esc(text)}</p>` : '');

export function renderMarketsScreen(state, now) {
  if (state.route.screen === 'markets' && state.route.id) {
    const asset = assetFor(state.markets, state.account?.data, state.route.id);
    if (asset) return marketPage(asset, state, now);
  }
  const m = state.markets;
  const q = m.q.trim();
  const rows = marketRows(m, state.account?.data);
  const tabs = `<div class="mk-tabs" role="group" aria-label="Markets">${MARKET_TABS.map(t => `<button type="button" class="mk-tab" data-action="mkTab" data-value="${t.id}" aria-pressed="${t.id === m.tab}">${t.label}</button>`).join('')}</div>`;
  const pressed = (MARKET_SORTS.find(s => s.id === m.sort) ?? MARKET_SORTS[0]).label;
  const left = q
    ? `<p class="mk-q">${rows.length} market${rows.length === 1 ? '' : 's'} for “${esc(q)}” <button type="button" class="mk-clear" data-action="mkClear">Clear</button></p>`
    : '<span></span>';
  const bar = `<div class="mk-bar">${left}${rows.length > 1 ? seg(MARKET_SORTS.map(s => s.label), pressed, 'mkSort') : ''}</div>`;
  const words = (q ? note(searchWord(m.search)) : note(connectionWord(m.connection))) + note(watchWord(m.watchError));
  const body = rows.length ? table(rows) : q ? '' : '<p class="mk-empty">Nothing watched yet</p>';
  return `<main class="main mkts"><div class="mk-head"><h1 class="head-title">Markets</h1>` +
    `<div class="search"><label for="mq" class="sr-only">Search markets</label>${icon('search', 18, 2)}<input id="mq" type="search" autocomplete="off" placeholder="Search markets" data-action="mkQuery"${attrs({ value: m.q })}></div></div>` +
    `<div class="mk">${tabs}${bar}${words}${body}</div></main>`;
}

// ---- a market's page: its head and keys, the price and its facts, then the chart beside what you hold of it, the
// statement's fills and the conversations that name it

const KIND = { us: 'Stock', cn: 'A-share', crypto: 'Crypto' };
const ACCOUNT_CLASS = { us: 'us_equity', crypto: 'crypto' };
const section = (label, inner, key = '') => `<section class="dsec" aria-label="${label}">${key ? `<div class="mk-sec-head"><div class="mk-h2">${label}</div>${key}</div>` : `<div class="mk-h2">${label}</div>`}${inner}</section>`;
const line = (mark, t1, t2, markClass = '') => `<div class="mk-line"><span class="${cls('mk-mark', markClass)}">${mark}</span><div class="mk-line-b"><div class="mk-t1">${t1}</div><div class="mk-t2">${t2}</div></div></div>`;
const qtyWord = n => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 }));
const when = (at, now) => { const t = Date.parse(at); return Number.isNaN(t) ? '' : sameDay(t, now) ? fmtClock(t) : `${fmtDate(t)} ${fmtClock(t)}`; };
const changeSpan = fraction => { const s = sign(fraction); return `<span class="${s === 'pos' ? 'up' : s === 'neg' ? 'down' : 'flat'}">${esc(pct(fraction))}</span>`; };
// a holding in its own unit: shares of a stock, the base of a coin
const heldWord = (asset, qty) => (asset.market === 'crypto' ? `${qtyWord(qty)} ${baseOf(asset)}` : `${qtyWord(qty)} share${qty === 1 ? '' : 's'}`);

export function marketPage(asset, state, now) {
  const m = state.markets;
  const data = state.account?.data;
  const id = esc(asset.id);
  const quote = m.quotes[asset.id] ?? m.hitQuotes[asset.id];
  const watched = m.watchlist.some(a => a.id === asset.id);
  const sub = [KIND[asset.market], asset.symbol, asset.exchange].filter(Boolean).join(' · ');
  const who = `<div class="mk-who">${mkAv(asset, 'lg')}<div><h1 class="head-title">${esc(nameOf(asset))}</h1><span class="mk-sub">${esc(sub)}</span></div></div>`;
  const keys = `<div class="mk-d-acts"><button type="button" class="btn" data-action="handToGravit" data-id="${id}">${icon('agent', 16, 2)}Hand to Gravit</button>` +
    `<button type="button" class="${cls('btn', watched && 'mk-on')}" data-action="toggleWatch" data-id="${id}" aria-pressed="${watched}">${icon('star', 16, 2)}${watched ? 'Watching' : 'Watch'}</button></div>`;

  const priced = number(quote?.price) !== null;
  const asOf = priced && quote.as_of && when(quote.as_of, now) ? `as of ${when(quote.as_of, now)} · ` : '';
  const facts = [['Previous close', price(quote?.prev_close, asset.currency)], ['Volume', volumeWord(asset, quote)], ['Source', sourceWord(quote ?? { market: asset.market })]];
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(price(quote?.price, asset.currency))}</span>` +
    `${priced ? `${chgHtml(number(quote.change_pct))}<span class="mk-basis">${esc(basisWord(quote))}</span>` : ''}</div>` +
    `<p class="mk-asof">${esc(asOf + quoteWord(quote))}</p>` +
    `<dl class="mk-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

  const left = [];
  const right = [];
  // daily bars exist for a us id only; the chart shows once they hold two closes
  const bars = asset.market === 'us' ? m.bars[asset.id]?.payload : null;
  const chart = bars ? chartSvg(bars.rows, { currency: asset.currency }) : '';
  if (chart) left.push(section('Price history', chart + note(barsWord(bars))));

  const p = portfolioOf(data);
  if (p.available) {
    const held = p.holdings.filter(h => h.id === asset.id)
      .map(h => line('·', `${esc(heldWord(asset, h.qty))} · ${esc(money(h.value, p.currency))}`, changeSpan(h.changeToday)));
    right.push(section('You hold', held.length ? `<div class="mk-feed">${held.join('')}</div>` : '<p class="mk-empty">You don’t hold any.</p>'));
    const fills = statementOf(data).filter(r => positionId({ symbol: r.symbol, asset_class: ACCOUNT_CLASS[asset.market] }) === asset.id).slice(0, 8)
      .map(r => line('✓', `${r.side === 'sell' ? 'Sell' : 'Buy'} ${esc(qtyWord(r.qty))} ${esc(r.symbol)} · ${esc(price(r.price, p.currency))}`,
        `${esc(when(r.at, now))}${r.amount !== null ? ` · ${esc(money(r.amount, p.currency))}` : ''}`, 'ok'));
    right.push(section('On the statement', fills.length ? `<div class="mk-feed">${fills.join('')}</div>` : '<p class="mk-empty">Nothing on the statement about it yet.</p>',
      '<button type="button" class="link mk-link" data-action="openStatement">Open the Statement →</button>'));
  }

  const about = mentionsOf(state.conversations, asset).map(c => `<a class="mk-line" href="#/messages/${esc(c.id)}" data-action="open" data-id="${esc(c.id)}"><span class="mk-mark">→</span>` +
    `<div class="mk-line-b"><div class="mk-t1">${esc(c.title)}</div>${c.updatedAt ? `<div class="mk-t2">${esc(rowTime(c.updatedAt, now))}</div>` : ''}</div></a>`);
  if (about.length) right.push(section('Gravit on it', `<div class="mk-feed">${about.join('')}</div>`));

  const cols = [left, right].filter(c => c.length).map(c => `<div class="mk-pg-col">${c.join('')}</div>`).join('');
  return `<main class="main mkts mk-page"><a id="page-back" class="back-link page-back" href="#/markets">‹ Markets</a><div class="mk-pg">` +
    `<header class="mk-pg-head">${who}${keys}</header><div class="mk-pg-top">${top}</div>` +
    `${cols ? `<div class="mk-pg-cols">${cols}</div>` : ''}</div></main>`;
}
