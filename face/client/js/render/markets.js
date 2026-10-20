// face/client/js/render/markets.js — Markets on the face (spec 2026-10-19 §7 Stage 2): the watchlist and the holdings, or
// the search's hits, each with its quote; tabs, the sort seg and one table. A market's page is #/markets/<id>. No Trade,
// no venues, no prediction cards: the face quotes and searches, the agent trades behind its own gates.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { chgHtml } from '../market-fmt.js';
import { price, number } from '../wire/market-model.js';
import { seg } from './controls.js';
import {
  MARKET_TABS, MARKET_SORTS, marketRows, assetFor, quoteWord, connectionWord, searchWord, watchWord, volumeWord,
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

const KIND = { us: 'Stock', cn: 'A-share', crypto: 'Crypto' };

// a market's page: the way back and its head; the price, the chart and what you hold of it follow
export function marketPage(asset, state, now) {
  const sub = [KIND[asset.market], asset.symbol, asset.exchange].filter(Boolean).join(' · ');
  const who = `<div class="mk-who">${mkAv(asset, 'lg')}<div><h1 class="head-title">${esc(nameOf(asset))}</h1><span class="mk-sub">${esc(sub)}</span></div></div>`;
  return `<main class="main mkts mk-page"><a id="page-back" class="back-link page-back" href="#/markets">‹ Markets</a><div class="mk-pg">` +
    `<header class="mk-pg-head">${who}</header></div></main>`;
}
