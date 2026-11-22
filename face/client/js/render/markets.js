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
// read has got. An A share's page reads none of the four. A market the watch holds a level for carries its mark (plan
// 2026-11-01-desk-p3-watch Task 11, host/desk-view.js markOf) after its name on its row, and with its plan and file under its
// price on its page; the desk's own status is the Desk screen's (render/desk-page.js).
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { maskExcerpt } from '../mask.js';
import { chgHtml, localPrice, localAmount, computePrice } from '../market-fmt.js';
import { fmtClock, fmtDate, rowTime, sameDay } from '../time.js';
import { price, number } from '../wire/market-model.js';
import { money, signedMoney, sign } from '../wire/account-model.js';
import { seg } from './controls.js';
import { candlesSvg, sessionsSvg } from './chart.js';
import { eventOf, eventBannerHtml, eventRangesHtml, eventHistoryHtml } from './event-window.js';
import { orderWords, marketKeysOn, marketKey, changeKey, positionKeys, positionSideWord, statementStatusWord, statementByWord } from './account.js';
import { marketLeverageSeedOf } from '../host/sheet-market.js';
import { assetKeyOf, hereOf, costOf, bookOf, tradesOf, fundingOf, fundingMissingOf } from '../host/market-depth-view.js';
import {
  candleRanges, localCandleRanges, isAccountKey, tableOf, pageOf, faceAssetOf, mentionsOf, volumeWordOf, followOf,
  connectionWord, watchWord, basisWord, watchedOf,
  chinaWord, cnStateWord, notAnsweringWord, cnPageOf, cnTileOf, cnBoardOf, marketOriginOf, noSpotSourceWord,
  localPageOf, localWord, localDownWord, localRefreshWord, localStateWord, regionWord, optionPageOf, compactNumber, DOLLAR_UNITS,
  computePageOf, computeCandleRanges,
} from '../host/market-view.js';
import { yuan, fix2 } from './lunhui/block.js';
import { intradaySvg } from './lunhui/intraday.js';
import { tradeableOf } from '../host/trade-view.js';
import { isCnKey } from '../wire/china.js';
import { isLocalKey } from '../wire/local.js';
import { isOptionKey, OPTION_COINS } from '../wire/options.js';
import { isComputeKey, ORNN } from '../wire/compute.js';
import { markOf } from '../host/desk-view.js';
import { t, th, thn, sayOf } from '../i18n/words.js';

const EM = '—';
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
// a record's own entry, never one it inherits
const own = (o, k) => (isRecord(o) && typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined);
const note = line => { const text = sayOf(line); return text ? `<p class="mk-note">${esc(text)}</p>` : ''; };
const empty = text => `<p class="mk-empty">${esc(text)}</p>`;
const tag = text => `<span class="mk-tag">${esc(text)}</span>`;
const tone = v => ({ pos: 'up', neg: 'down' })[sign(v)] ?? 'flat';
// a quantity as the Account gives it, grouped (0.124, 63,226.6); nothing given is no word
const qtyWord = n => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 }));
const when = (at, now) => { const ms = Date.parse(at); return Number.isNaN(ms) ? '' : sameDay(ms, now) ? fmtClock(ms) : t('time.dayClock', { day: fmtDate(ms), clock: fmtClock(ms) }); };

/** A round letter tile: the first word of what it is given — a market's base, an event's category — four letters at most. */
export function mkAv(name, size = '') {
  const word = String(name ?? '').trim().split(/\s+/)[0].slice(0, 4);
  return `<span class="${cls('mk-av', size && `mk-av-${size}`)}" aria-hidden="true">${esc(word)}</span>`;
}

// Local, compact venue marks: they stay visible beside a contract when the Source column is hidden on a narrow screen.
// The name is available to assistive technology and on hover; the glyph itself is decorative.
export function sourceBadge(origin, decorative = false) {
  if (origin !== 'hyperliquid' && origin !== 'xyz') return '';
  const name = origin === 'xyz' ? t('markets.scope.xyz') : t('markets.scope.hyperliquid');
  const mark = origin === 'xyz' ? '<span aria-hidden="true">xyz</span>'
    : '<svg viewBox="0 0 24 18" width="19" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.7 3.1C1.4 3.1.4 5.6.4 9s1.1 5.9 3.4 5.9c2.8 0 3.6-4 5.6-4 2.2 0 2.4 5.2 6.5 5.2 4.8 0 7.7-2.8 7.7-7.1S20.8 1.9 16 1.9c-4.1 0-4.5 5.2-6.6 5.2-2 0-2.8-4-5.7-4Z"></path></svg>';
  return `<span class="mk-source-badge mk-source-${origin}"${attrs(decorative ? { 'aria-hidden': 'true' } : { role: 'img', 'aria-label': name, title: name })}>${mark}</span>`;
}
const badgeFor = legs => sourceBadge(marketOriginOf(legs.find(l => l.connected) ?? legs.find(l => l.public)));

const LOCAL_UNITS = new Set(['hkd', 'krw', 'twd']);
/** A price in its unit's words: an event's in cents (62¢, 62.5¢), an A share's in yuan, a local share's in its currency (HK$400.00,
 *  ₩71,500, NT$1,025.00), an index's level bare, anything else in dollars; none is —. */
export function priceWord(v, unit) {
  if (v === null || v === undefined) return EM;
  // a cash index's level: a number, no currency; a local share's price in its own currency (Hong Kong, Korea, Taiwan)
  if (unit === 'level') return localPrice(v, null);
  // a compute index's settle: in dollars, three significant digits under $1
  if (unit === 'compute') return computePrice(v);
  if (LOCAL_UNITS.has(unit)) return localPrice(v, unit.toUpperCase());
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
  return `<span class="${up ? 'up' : 'down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span><span class="sr-only">${up ? th('markets.move.up') : th('markets.move.down')}</span> ${size}</span>`;
}

// ---- the table

// the star, and under it Watched at the Account for a market on the Account's own list alone; a Watchlist row (`noStar`, G6)
// has none: it is un-starred from its own tab or a search result
function starCell(r) {
  return `<button type="button" class="mk-star" data-action="toggleWatch" data-id="${esc(r.id)}" aria-pressed="${r.watched === true}" aria-label="${r.watched ? th('markets.star.stop', { name: r.name }) : th('markets.star.watch', { name: r.name })}">${icon('star', 18, 2)}</button>` +
    (r.watched === true && r.atAccount === true ? `<span class="mk-at">${th('markets.star.atAccount')}</span>` : '');
}

// a Watchlist row no tab or search can reach to un-star — an old star the Account could not find, a star no read lists — keeps
// Remove after its name (the old star's taken off, the other un-starred)
function removeKey(r) {
  if (r.notListed) return `<button type="button" class="mk-clear" data-action="removeAsked" data-id="${esc(r.id)}" aria-label="${th('markets.star.removeName', { name: r.name })}">${th('markets.star.remove')}</button>`;
  if (r.placeholder) return `<button type="button" class="mk-clear" data-action="toggleWatch" data-id="${esc(r.id)}" aria-label="${th('markets.star.removeName', { name: r.name })}">${th('markets.star.remove')}</button>`;
  return '';
}

// the tile, the name and under it a search result's class, the sub, Closed past its end, Paper where only a paper account trades
// it first; a market no read lists, and a star the Account could not find, have no page to open
function nameCell(r, mark = null) {
  const tags = [r.pastEnd ? t('markets.tag.closed') : '', r.paper ? t('markets.tag.paper') : ''].filter(Boolean).map(tag).join(' ');
  const badge = badgeFor(r.legs ?? []);
  const kind = r.className ? `${tag(r.className)} ` : '';
  const inner = `${mkAv(r.tile)}<span class="mk-nm"><b>${esc(r.name)}</b>${mark ? levelMark(mark) : ''}<span class="mk-sub">${kind}${badge ? `${badge} ` : ''}${esc(r.sub)}${tags ? ` ${tags}` : ''}</span></span>`;
  return r.placeholder || r.notListed ? `<span class="mk-who">${inner}${removeKey(r)}</span>`
    : `<button type="button" class="mk-name" data-action="openMarket" data-id="${esc(r.id)}">${inner}</button>`;
}

// a row's volume: an A share's turnover in yuan (China's rows), else the view's word in its unit
const volumeCell = p => (p.volumeUnit === 'yuan' ? yuan(p.volume) : volumeWordOf(p));

// a cash index's change in points, signed; nothing given is —
const pointsWord = v => (v === null || v === undefined ? EM : `${v > 0 ? '+' : ''}${localPrice(v, null)}`);

// a row: its price, its move and its volume; a cash index's (on its region's own table) its level, its change in points and its
// change in percent
// an index's unit after its price (/GPU·hr, /M tokens)
const perUnitHtml = r => (r.perUnit ? ` <span class="mk-unit">${esc(r.perUnit)}</span>` : ''); // words-order: a price, then its unit
function row(r, markFor, starred, levels = false, settleHead = false) {
  const index = levels && r.kind === 'index';
  // an index's change is from the previous settle: said by its column's head on Compute's own table, else beside it
  const basis = r.kind === 'computeIndex' && !settleHead ? ` <span class="mk-basis">${th('markets.compute.change')}</span>` : ''; // words-order: a change, then what it is against
  const move = index ? `<span class="${tone(r.priced.change24h)}">${esc(pointsWord(r.priced.change24h))}</span>` : moveHtml(r.priced) + basis;
  const third = index ? moveHtml(r.priced) : esc(volumeCell(r.priced));
  return `<tr data-id="${esc(r.id)}">${starred ? `<td>${r.noStar ? '' : starCell(r)}</td>` : ''}<td class="mk-c-name">${nameCell(r, markFor(r.id))}</td>` +
    `<td class="r">${esc(priceWord(r.price, r.priced.unit))}${perUnitHtml(r)}</td><td class="r mk-c-chg">${move}</td>` +
    `<td class="r mk-c-vol">${third}</td><td class="r mk-c-st"><span class="mk-st">${esc(r.sourceWord)}</span></td></tr>`;
}

// the table's heads after Market: China's table says Today and Turnover where the Account's say 24h and Volume (spec 2026-10-31
// §4); a region's own share table Change and Turnover; its cash indices' Level, Change and Change % (spec 2026-11-20 §5.6)
function heads(local, compute = false) {
  // Compute's own table (Spot): its indices' change from the previous settle
  if (compute) return [th('markets.head.price'), th('markets.compute.change'), th('markets.head.volume')];
  if (local?.venue === 'ix') return [th('markets.head.level'), th('markets.head.change'), th('markets.head.changePct')];
  if (local?.venue === 'china') return [th('markets.head.price'), th('markets.head.today'), th('markets.head.turnover')];
  if (local) return [th('markets.head.price'), th('markets.head.change'), th('markets.head.turnover')];
  return [th('markets.head.price'), '24h', th('markets.head.volume')];
}

// a table of Watchlist rows alone draws no star column (G6), and no table draws a region's
function table(rows, { local = null, markFor = () => null, compute = false } = {}) {
  const starred = rows.some(r => !r.noStar);
  // Compute's head says what an index's change is against when every row is an index
  const settleHead = compute && rows.every(r => r.kind === 'computeIndex');
  const [price, move, third] = heads(local, settleHead);
  const head = `<tr>${starred ? `<th scope="col"><span class="sr-only">${th('markets.head.watch')}</span></th>` : ''}<th scope="col" class="mk-c-name">${th('markets.head.market')}</th><th scope="col" class="r">${price}</th>` +
    `<th scope="col" class="r mk-c-chg">${move}</th><th scope="col" class="r mk-c-vol">${third}</th><th scope="col" class="r mk-c-st">${th('markets.head.source')}</th></tr>`;
  const levels = local?.venue === 'ix';
  return `<section class="cardbox mk-tcard" aria-label="${th('nav.markets')}"><div class="mk-wrap"><table class="mk-t"><thead>${head}</thead><tbody>${rows.map(r => row(r, markFor, starred, levels, settleHead)).join('')}</tbody></table></div></section>`;
}

// an options view's table (spec 2026-11-22 §5.4): a row an underlying — its price with its day change, its nearest expiry, its volume,
// its open interest, the ATM IV, where its figures are from; no star (a chain is not a market to watch)
function optionRow(r) {
  const o = r.option;
  return `<tr data-id="${esc(r.id)}"><td class="mk-c-name">${nameCell(r)}</td>` +
    `<td class="r">${esc(priceWord(r.price, 'usd'))} <span class="mk-opt-chg">${moveHtml(r.priced)}</span></td>` + // words-order: a price, then its move
    `<td class="r">${esc(o.expiry || EM)}</td><td class="r mk-c-vol">${esc(o.volume)}</td><td class="r mk-c-vol">${esc(o.openInterest || EM)}</td>` +
    `<td class="r mk-c-chg">${esc(o.atmIv || EM)}</td><td class="r mk-c-st"><span class="mk-st">${esc(r.sourceWord)}</span></td></tr>`;
}
function optionTable(rows) {
  const head = `<tr><th scope="col" class="mk-c-name">${th('markets.head.underlying')}</th><th scope="col" class="r">${th('markets.head.price')}</th>` +
    `<th scope="col" class="r">${th('markets.head.nearestExpiry')}</th><th scope="col" class="r mk-c-vol">${th('markets.head.volume')}</th>` +
    `<th scope="col" class="r mk-c-vol">${th('markets.head.openInterest')}</th><th scope="col" class="r mk-c-chg">${th('markets.head.atmIv')}</th>` +
    `<th scope="col" class="r mk-c-st">${th('markets.head.source')}</th></tr>`;
  return `<section class="cardbox mk-tcard" aria-label="${th('nav.markets')}"><div class="mk-wrap"><table class="mk-t"><thead>${head}</thead><tbody>${rows.map(optionRow).join('')}</tbody></table></div></section>`;
}
// under an options view's rows: the sources that did not answer, then the market's notes (each source's figures, a list read in part),
// and As of the last read for a list it re-served
function optionNotes(view) {
  const down = view.missing.map(x => note(t('markets.empty.missing', { source: x.name })) + note(x.why)).join(''); // words-order: the sentence, then the market's words
  return down + view.notes.map(note).join('') + (view.stale ? note(t('markets.asOfLast')) : '');
}

// where the rows would be when there are none (tableOf's `empty`, else the read they are from): the Watchlist with nothing
// starred (G6); a tab whose read answered with nothing under its filters, with Back to the main sources where a Form or a Source
// is set (§5.3); Stocks › Japan or India on Spot, which no free source lists; China A's ranking; a search's answer with nothing in it; a read still on its way, or one that failed before it
// answered
function emptyHtml(view, m) {
  const { read, searching, china, local, empty: kind, filters } = view;
  if (kind === 'watchlist') return empty(t('markets.empty.watchlist'));
  // Stocks › Japan or India on Spot: no free source lists those shares
  if (kind === 'noSpot') return empty(noSpotSourceWord(m) ?? '');
  if (china) return empty(read.status === 'error' ? t('markets.empty.china') : read.answered && read.status === 'ready' ? t('markets.none') : t('common.loading'));
  // a region's own read (Hong Kong, Korea, Taiwan, the indices): its source named when it failed; no main sources to go back to
  if (local) return empty(read.status === 'error' && !read.answered ? localDownWord(local.venue) : read.answered ? t('markets.none') : t('common.loading'));
  if (kind === 'filters') {
    const back = filters?.chips?.length ? ` <button type="button" class="mk-clear" data-action="mkMain">${th('markets.empty.back')}</button>` : '';
    // a source that did not answer is the likelier reason than the filters: named first, the market's own words under it
    const down = (view.missing ?? []).map(x => `<p class="mk-empty">${esc(t('markets.empty.missing', { source: x.name }))}</p>` + // words-order: the sentence, then the market's words
      (x.why ? `<p class="mk-note">${esc(x.why)}</p>` : '')).join('');
    return `${down}<p class="mk-empty">${th('markets.empty.filters')}${back}</p>`; // words-order: the sentence, then its key
  }
  if (read.answered) return empty(t('markets.none'));
  if (read.status !== 'error') return empty(searching ? t('markets.search.searching') : t('common.loading'));
  return empty(searching ? t('markets.search.unavailable') : t('markets.unavailable'));
}

// the search's A shares, while a query is active: the Account answered without China's hits (its `missing` names china) —
// Search is unavailable for them; else nothing (their hits drawn, or none matching)
function cnSearchWord(m, searching) {
  const body = m.results?.data;
  const missed = body?.ok === true && records(body.missing).some(x => x.venue === 'china');
  return searching && missed ? t('markets.search.unavailable') : '';
}

// China's muted lines: the session's (Closed, the midday break); then the market's own words when it says China's read is stale,
// else, for a ranking the proxy re-served as last read (the market not answering), that; else a refresh that failed over the
// rows kept
function chinaLines(read, data, session) {
  const why = data?.status?.state === 'stale' ? sayOf(data.status.said).trim()
    : data?.stale === true ? notAnsweringWord()
    : read.status === 'error' && read.answered ? t('markets.cn.refreshFailed') : '';
  return note(chinaWord(session)) + note(why);
}

// a region's own muted lines, as China's: its session's (Closed and the last session's day, the lunch break), then the market's
// words when it says the read is stale, else the market not answering, else a refresh that failed over the rows kept, its source named
function localLines(local, read, data, session) {
  const why = data?.status?.state === 'stale' ? sayOf(data.status.said).trim()
    : data?.stale === true ? t('markets.local.notAnswering')
    : read.status === 'error' && read.answered ? localRefreshWord(local.venue) : '';
  return note(localWord(session)) + note(why);
}

// the tab row (G1): the Watchlist first, a star with its word for a screen reader alone, filled while open; then a word a tab,
// no counts
function tabsHtml(tabs, current) {
  return `<div class="mk-tabs" role="group" aria-label="${th('nav.markets')}">${tabs.map(tab => {
    const pressed = `aria-pressed="${tab.id === current}"`;
    return tab.id === 'watchlist'
      ? `<button type="button" class="mk-tab mk-tab-star" data-action="mkTab" data-value="watchlist" ${pressed} title="${esc(tab.label)}">${icon('star', 20, 2)}<span class="sr-only">${esc(tab.label)}</span></button>`
      : `<button type="button" class="mk-tab" data-action="mkTab" data-value="${esc(tab.id)}" ${pressed}>${esc(tab.label)}</button>`;
  }).join('')}</div>`;
}

// a filter's pill and, while open, its popover: each option a choice, one the view greys disabled with its note, a main source
// marked main
function pillHtml(name, label, word, set, open, options, action, value) {
  const opts = options.map(o => {
    const aside = o.note ?? (o.main ? t('markets.source.mainMark') : null);
    return `<button type="button" role="option" class="mk-opt" data-action="${action}"${attrs({ 'data-value': o.id })} aria-selected="${o.id === value}"${o.disabled ? ' disabled' : ''}>` +
      `<span>${esc(o.label)}</span>${aside ? `<span class="mk-opt-note">${esc(aside)}</span>` : ''}</button>`;
  }).join('');
  return `<div class="mk-filter"><button type="button" class="${cls('mk-pill', set && 'mk-pill-set')}" data-action="mkFilter" data-value="${name}" aria-expanded="${open}" aria-haspopup="listbox">` +
    `<span class="mk-pill-k">${label}</span><span class="mk-pill-v">${esc(word)}</span>${icon('chevDown', 14, 2)}</button>` + // words-order: a filter's name, then its value
    (open ? `<div class="mk-pop" role="listbox" aria-label="${label}">${opts}</div>` : '') + '</div>';
}

// the filters (G2–G4): Region on Stocks and Indices, Form, Source, each with its popover; a chip for a Form set and a Source
// other than Main, each removed by its key
function filtersHtml(f, open) {
  if (!f) return '';
  const region = f.region
    ? pillHtml('region', th('markets.filter.region'), f.region.options.find(o => o.id === f.region.value)?.label ?? f.region.value, false, open === 'region', f.region.options, 'mkRegion', f.region.value)
    : '';
  const form = pillHtml('form', th('markets.filter.form'), f.form.label, f.form.value !== '', open === 'form', f.form.options, 'mkForm', f.form.value);
  const source = pillHtml('source', th('markets.filter.source'), f.source.label, f.source.value !== 'main', open === 'source', f.source.options, 'mkSource', f.source.value);
  const chips = f.chips.map(c => `<button type="button" class="mk-chip" data-action="mkChip" data-value="${c.kind}" aria-label="${th('markets.chip.remove', { what: c.label })}"><span>${esc(c.label)}</span>${icon('x', 14, 2)}</button>`).join('');
  return `<div class="mk-filters">${region}${form}${source}${chips}</div>`;
}

export function renderMarketsScreen(state, now) {
  const id = state.route?.screen === 'markets' ? state.route.id : null;
  if (id) {
    const page = marketPage(id, state, now);
    if (page) return page;
  }
  const m = state.markets;
  const q = String(m.q ?? '').trim();
  const view = tableOf(m, now, state.account?.data);
  const { rows, tabs, sorts, sort, read, china, local, session, searching, filters } = view;
  const tabWord = tabs.find(tab => tab.id === m.tab)?.label ?? '';
  // while searching (G5) the filters are set aside: the search's count and Back to <tab>, which ends it
  const left = searching
    ? `<p class="mk-q">${thn('markets.search.count', rows.length, { q })} <button type="button" class="mk-clear" data-action="mkBack">${th('markets.search.back', { tab: tabWord })}</button></p>`
    : filtersHtml(filters, m.open) || '<span></span>';
  const bar = `<div class="mk-bar">${left}${rows.length > 1 ? seg(sorts.map(s => [s.label, s.id]), sort, 'mkSort') : ''}</div>`;
  // the muted lines: the Account's own sentence when the read the rows are from refused, the A-share search's when it failed or
  // answered in part (said once: not again under a table that already says it), the face's wire's state where an A share is
  // drawn, the watchlist's
  const emptyBody = rows.length ? '' : emptyHtml(view, m);
  const cnSearch = cnSearchWord(m, searching);
  const cnDrawn = rows.some(r => r.source === 'face' && !r.notListed);
  const chinaWords = china ? chinaLines(read, m.rank?.data, session) : local ? localLines(local, read, m.rank?.data, session) : '';
  // China's failure is said once, in the face's words: the route's own error text is not a sentence of the Account's
  const cnLine = cnSearch && !emptyBody.includes(`>${esc(cnSearch)}<`) ? cnSearch : '';
  const words = chinaWords + note(local ? '' : read.message) + note(cnLine) + (cnDrawn ? note(connectionWord(m.connection)) : '') + note(watchWord(m.watchError));
  const body = rows.length
    ? view.options ? optionTable(rows) + optionNotes(view)
      // Compute: its rows, then the market's notes under them (what its indices are, a source read in part), as an options view's
      : table(rows, { local, markFor: id => markOf(state.desk?.data, id), compute: view.compute }) + (view.compute ? optionNotes(view) : '')
    // an options view or Compute with no rows still says the market's notes (a list read in part, each source's figures)
    : emptyBody + (view.options || view.compute ? view.notes.map(note).join('') + (view.stale ? note(t('markets.asOfLast')) : '') : '');
  return screenHtml(m, tabsHtml(tabs, m.tab), `${bar}${words}${body}`);
}

// the screen: its head with the search, the tabs, and what the tab draws
const screenHtml = (m, tabs, inner) => `<main class="main mkts"><div class="mk-head"><h1 class="head-title">${th('nav.markets')}</h1>` +
  `<div class="search"><label for="mq" class="sr-only">${th('markets.search.label')}</label>${icon('search', 18, 2)}<input id="mq" type="search" autocomplete="off" placeholder="${th('markets.search.label')}" data-action="mkQuery"${attrs({ value: m.q })}></div></div>` +
  `<div class="mk">${tabs}${inner}</div></main>`;

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
  return `<main class="main mkts mk-page"><a id="page-back" class="back-link page-back" href="#/markets">${th('markets.back')}</a><div class="mk-pg">` +
    `<header class="mk-pg-head">${who}${keys}</header><div class="mk-pg-top">${top}</div>` +
    `${cols ? `<div class="mk-pg-cols">${cols}</div>` : ''}</div></main>`;
};
// a key opening the Trade ticket on the market, at a side
const ticketKey = (id, side, word) => `<button type="button" class="btn" data-action="openTicket" data-id="${esc(id)}" data-side="${side}">${word}</button>`;
// the page's keys: Buy, and Sell where it is held, when `trade` is given (an Account market on a page that signs); Hand to
// gravit; Watch — and a perpetual's Leverage… (`leverage`, its seed) where it is given
// a US share's page leads to its option chain (any ticker: the chain's page says when Nasdaq lists none) — but a ticker spelled as a
// coin the market reads options on (stock:BTC, a fund's) would open the coin's chain, so it has none
const US_TICKER = /^stock:([A-Z.]{1,6})$/;
const optionsKey = id => { const m = US_TICKER.exec(id); return m && !OPTION_COINS.includes(m[1]) ? `<a class="btn" href="#/markets/opt:${esc(m[1])}">${th('markets.form.option')}</a>` : ''; };
const keysHtml = (id, watched, trade = null, leverage = null) => `<div class="mk-d-acts">${trade ? ticketKey(id, 'buy', th('trade.buy')) + (trade.held ? ticketKey(id, 'sell', th('trade.sell')) : '') : ''}` +
  `${leverage ? marketKey('leverage', leverage, t('account.key.leverage'), 'btn') : ''}${optionsKey(id)}` +
  `<button type="button" class="btn" data-action="handToGravit" data-id="${esc(id)}">${icon('agent', 16, 2)}${th('markets.hand')}</button>` + // words-order: an icon, then its word
  `<button type="button" class="${cls('btn', watched && 'mk-on')}" data-action="toggleWatch" data-id="${esc(id)}" aria-pressed="${watched}">${icon('star', 16, 2)}${watched ? th('markets.tab.watching') : th('markets.head.watch')}</button></div>`; // words-order: an icon, then its word
const aboutHtml = (conversations, asset, now) => mentionsOf(conversations, asset).map(c => `<a class="mk-line" href="#/messages/${esc(c.id)}"><span class="mk-mark">→</span>` +
  `<div class="mk-line-b"><div class="mk-t1">${esc(maskExcerpt(c.title))}</div>${c.updatedAt ? `<div class="mk-t2">${esc(rowTime(c.updatedAt, now))}</div>` : ''}</div></a>`);

// a part of the page as its read allows (the view's `reads`): Loading… until that read has answered, and once it has failed
// before any answer the Account's sentence over <unavailable>; after an answer its lines, or <none> — a later failure's sentence
// over the lines kept
function partBody(r, lines, none, unavailable) {
  const kept = r.failed ? note(r.message) : '';
  if (!r.answered) return `${kept}${empty(r.failed ? unavailable : t('common.loading'))}`;
  return `${kept}${lines.length ? feed(lines) : none ? empty(none) : ''}`;
}

/** A market's page, or '' for an id no read lists (the screen then draws the table): an A share's (a cn: id) its own, from its
 *  quote and history, reached cold or not; another Account key's from its reads. */
export function marketPage(id, state, now) {
  // an option chain's page: its strikes at the venue and expiry picked
  if (isOptionKey(id)) return optionPage(id, state);
  // an index's page: its settles and its quote at the market
  if (isComputeKey(id)) return computePage(id, state, now);
  if (!isCnKey(id) && isAccountKey(id)) {
    const view = pageOf(state.markets, state.account, id, now);
    return view ? accountPage(id, view, state, now) : '';
  }
  // a Hong Kong, Korean or Taiwanese share's page, a cash index's: the A share's kind of page, from its quote and its history
  if (isLocalKey(id) && !isCnKey(id)) return localPage(id, state, now);
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
  const kept = p.status === 'error' ? note(p.message) : '';
  if (!answered) return `${kept}${empty(p.status === 'error' ? unavailable : t('common.loading'))}`;
  const stale = isRecord(data) && data.stale === true;
  const at = stale ? (timeOf() || (typeof p.freshAt === 'number' ? new Date(p.freshAt).toISOString() : '')) : '';
  const asOf = stale ? note(at ? t('markets.asOf', { when: when(at, now) }) : t('markets.asOfLast')) : '';
  return `${kept}${asOf}${draw()}`;
}

// what was paid, under a holding or a position: the average paid in the market's unit and the cost, then the Account's words
function costWords(c, unit) {
  if (!c) return '';
  const avg = c.avgCostUsd === null ? '' : t('markets.cost.avg', { price: priceWord(unit === 'cents' ? c.avgCostUsd * 100 : c.avgCostUsd, unit) });
  return [avg, c.costUsd === null ? '' : t('markets.cost.cost', { cost: money(c.costUsd) }), c.words].filter(Boolean).join(' · '); // words-order: what was paid under the visual separator
}

// a position held here: its side worded, how many and its symbol — one with no side, size or symbol, its parts as they came
function positionWords(p) {
  const side = positionSideWord(p.side);
  const qty = qtyWord(p.qty);
  return side && qty && p.symbol ? t('markets.here.position', { side, qty, symbol: p.symbol })
    : [side, qty, p.symbol].filter(Boolean).join(' '); // words-order: a position with no side, size or symbol, its parts as they came
}
// a funding line's position: its side worded and its size; one with no side or no size, the part it has
const heldWords = l => {
  const side = positionSideWord(l.side);
  const qty = qtyWord(l.qty);
  return side && qty ? t('markets.funding.held', { side, qty }) : side || qty;
};
// a statement line's status and who it was by, each worded, under the visual separator
const statedWords = l => [statementStatusWord(l.status), statementByWord(l.by)].filter(Boolean).join(' · '); // words-order: a statement line's facts under the visual separator

// You here: the venues the sheet could not read; the holding, the positions with their cost and keys, the owner's open orders
// with Change…; and under What agents do here a line per agent action — an order of theirs working here (with its Change…), a
// statement line by them — so an agent's order is drawn once. A market the asset read does not name (an event no venue connected lists) holds nothing here.
function youHere(view, part, here, keyed, page, now, quotes = null) {
  if (!assetKeyOf(view.item)) return empty(t('markets.here.none'));
  const unit = view.priced.unit;
  const tail = keys => (keys.length ? `<span class="btn-row">${keys.join('')}</span>` : '');
  return depthBody(part, () => {
    const h = here.held;
    const lines = [
      ...(h ? [line('·', esc(`${[qtyWord(h.amount), h.asset].filter(Boolean).join(' ')} · ${money(h.usd)}`), esc(costWords(costOf(here, { key: h.key }), unit)))] : []),
      ...(here.paperHeld ? [line('·', `${esc(`${[qtyWord(here.paperHeld.amount), here.paperHeld.asset].filter(Boolean).join(' ')} · ${money(here.paperHeld.usd)}`)} ${tag(t('markets.tag.paper'))}`,
        esc(costWords(costOf(here, { key: here.paperHeld.key, paper: true }), unit)))] : []),
      ...here.positions.map(p => line('·', `${esc(`${p.venueName || p.venue} · ${positionWords(p)} · `)}` +
        `<span class="${tone(p.unrealizedUsd)}">${esc(signedMoney(p.unrealizedUsd))}</span>${p.paper ? ` ${tag(t('markets.tag.paper'))}` : ''}`,
        esc(costWords(costOf(here, p), unit)), '', keyed ? tail(positionKeys(p, page, quotes)) : '')),
      ...here.orders.filter(o => o.mine).map(o => line('·', esc(orderWords(o)), '', '', keyed ? tail([changeKey(o, page)].filter(Boolean)) : '')),
    ];
    const agents = here.agents.map(a => (a.type === 'order' ? line('·', esc(orderWords(a.order)), '', '', keyed ? tail([changeKey(a.order, page)].filter(Boolean)) : '')
      : line(DONE.has(a.line.status) ? '✓' : '·', esc([when(a.line.at, now), a.line.description, money(a.line.amountUsd)].filter(Boolean).join(' · ')),
        esc(statedWords(a.line)), DONE.has(a.line.status) ? 'ok' : '')));
    return here.missing.map(note).join('') + (lines.length ? feed(lines) : empty(t('markets.here.none'))) +
      (agents.length ? `<div class="mk-h3">${th('markets.here.agents')}</div>${feed(agents)}` : '');
  }, t('account.unavailable'), now);
}

// a figure of the book or the trades in the market's unit (an event's in cents), a size as the source gives it
const unitPrice = (v, unit) => priceWord(v === null ? null : unit === 'cents' ? Number((v * 100).toPrecision(12)) : v, unit);
const sizeWord = n => (n === null || n === undefined ? EM : qtyWord(n));

// the order book: ten levels a side, best first, bids beside asks; whose book it is, in its words; Top of book only for a book
// that is the best bid and ask alone
function bookHtml(b, unit) {
  const rows = Math.min(10, Math.max(b.bids.length, b.asks.length));
  if (!rows) return empty(t('markets.book.none'));
  const cell = (l, side) => (l ? `<td class="r ${side}">${esc(unitPrice(l.price, unit))}</td><td class="r">${esc(sizeWord(l.size))}</td>` : '<td></td><td></td>');
  const body = Array.from({ length: rows }, (_, i) => `<tr>${cell(b.bids[i], 'up')}${cell(b.asks[i], 'down')}</tr>`).join('');
  return `<table class="mk-book"><thead><tr><th scope="col" class="r">${th('markets.book.bid')}</th><th scope="col" class="r">${th('markets.book.size')}</th><th scope="col" class="r">${th('markets.book.ask')}</th><th scope="col" class="r">${th('markets.book.size')}</th></tr></thead>` +
    `<tbody>${body}</tbody></table>${note([b.from, b.depth === 'top' ? t('markets.book.top') : ''].filter(Boolean).join(' · '))}`; // words-order: whose book, then its depth, under the visual separator
}

// the latest trades: twenty, newest first — the price, the size, the side that took where the source says it, when — or the
// Account's sentence when the source publishes none
function tradesHtml(tr, unit, now) {
  if (!tr.trades.length) return empty(tr.none || t('markets.trades.none'));
  return feed(tr.trades.slice(0, 20).map(x => line('·', esc([unitPrice(x.price, unit), sizeWord(x.size)].join(' · ')),
    esc([x.side === 'buy' ? t('trade.buy') : x.side === 'sell' ? t('trade.sell') : '', when(x.at, now)].filter(Boolean).join(' · ')), x.side === 'buy' ? 'up' : x.side === 'sell' ? 'down' : ''))); // words-order: a trade's side and time under the visual separator
}

// a perpetual's funding: what was paid out of the position, what was received, each hour's line newest first; None yet. when
// there is none
function fundingHtml(lines, now) {
  if (!lines.length) return empty(t('markets.funding.none'));
  return feed(lines.map(l => {
    const paid = l.usd === null ? '' : l.usd >= 0 ? t('markets.funding.paid', { usd: money(l.usd) }) : t('markets.funding.received', { usd: money(-l.usd) });
    const rate = l.rate === null ? '' : t('markets.funding.rate', { rate: `${(l.rate * 100).toFixed(4)}%` });
    return line('·', `${esc(paid || EM)}${l.paper ? ` ${tag(t('markets.tag.paper'))}` : ''}`,
      esc([when(l.at, now), l.venueName, heldWords(l), rate].filter(Boolean).join(' · ')), l.usd !== null && l.usd < 0 ? 'ok' : ''); // words-order: a funding line's facts under the visual separator
  }));
}

function accountPage(id, view, state, now) {
  const { priced } = view;
  const unit = priced.unit;
  const closes = view.closesAt ? t('markets.closes', { date: fmtDate(Date.parse(view.closesAt)) }) : '';
  const badge = badgeFor(view.legs);
  const who = `<div class="mk-who">${mkAv(view.tile, 'lg')}<div><h1 class="head-title">${esc(view.name)}</h1>` +
    `<span class="mk-sub">${badge ? `${badge} ` : ''}${esc([...view.sub, closes].filter(Boolean).join(' · '))}${view.item.pastEnd === true ? ` ${tag(t('markets.tag.closed'))}` : ''}</span></div></div>`;

  // the price it shows, its 24 hours and its volume the explore read's; where the price is from, with its age, once, under it, as
  // the retired page says it; an event's outcomes under the price
  const moved = (unit === 'cents' ? priced.change24h : priced.changePct) !== null;
  const outcomes = view.outcomes.map(o => `<span class="mk-out">${esc(`${o.label} ${priceWord(o.cents, 'cents')}`)}</span>`);
  const facts = [[th('markets.fact.volume'), volumeWordOf(priced)], [th('account.tab.venues'), String(view.legs.length)]];
  // a stock's page at an event (analog event table Task 9): the banner above the price, its window in place of the history
  const ev = eventOf(state, id);
  const top = `${ev ? eventBannerHtml(ev) : ''}<div class="mk-d-px"><span class="mk-big">${esc(priceWord(view.price, unit))}</span>${moved ? `${moveHtml(priced)}<span class="mk-basis">24h</span>` : ''}</div>` +
    `${outcomes.length ? `<div class="mk-outs">${outcomes.join('')}</div>` : ''}${view.sourceWord ? `<p class="mk-asof">${esc(view.sourceWord)}</p>` : ''}` +
    planHtml(markOf(state.desk?.data, id)) +
    `<dl class="mk-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

  const left = [];
  const right = [];
  // Price history: the Account's ranges, the one kept pressed. Under it, a failed read's sentence (else History unavailable); the
  // closes kept for the range, with the Account's own words under them, or No history when it answered with fewer than two —
  // kept while the range is read again; Loading… while a range not drawn yet is read; nothing before a read
  const h = view.history;
  if (ev) left.push(section(th('markets.history.title'), eventHistoryHtml(ev, now), eventRangesHtml(id)));
  else {
    const svg = h.current ? candlesSvg(view.candles.candles, { unit, range: view.range }) : '';
    const failed = h.status === 'error' ? note(h.message || t('markets.history.unavailable')) : '';
    const closesDrawn = h.current ? (svg ? svg + note([view.candles.ends, view.candles.note].filter(w => typeof w === 'string' && w.trim() !== '').join(' · ')) : note(t('markets.history.none')))
      : h.status === 'loading' ? note(t('common.loading')) : '';
    left.push(section(th('markets.history.title'), failed + closesDrawn, seg(candleRanges(), view.range, 'setRange', { 'data-id': id })));
  }
  // Across venues: the lines the owner connected, the best marked, Paper where so; a public listing leads to Venues to connect
  const venues = view.legs.map(l => line('·',
    `${esc([l.venueName || l.venue, l.symbol, priceWord(l.price, unit)].filter(Boolean).join(' · '))}${l.best ? ` ${tag(t('markets.tag.best'))}` : ''}${l.paper ? ` ${tag(t('markets.tag.paper'))}` : ''}`,
    '', '', !l.connected && l.public && l.connectTo ? `<a class="link mk-link" href="#/account/venues">${th('markets.connectToTrade')}</a>` : ''));
  if (venues.length) left.push(section(th('markets.venues.title'), feed(venues)));

  // You here, from the asset sheet: what is held of it, its positions with their cost, its open orders with who placed them, and
  // what agents do here; on a page that signs for an Account that takes writes, a position's Close… (Sell…) and Leverage…, an
  // order's Change…
  const keyed = marketKeysOn(state);
  const page = state.account?.data;
  const kept = own(state.markets?.depth, id);
  const depth = Object.fromEntries(['here', 'book', 'trades', 'funding'].map(k => [k, isRecord(own(kept, k)) ? kept[k] : {}]));
  const here = hereOf(depth.here.data, page);
  const hereAnswered = depth.here.data != null;
  right.push(section(th('markets.here.title'), youHere(view, depth.here, here, keyed, page, now, state.markets?.accountQuotes)));
  // the order book and the latest trades at the line the page follows
  const follows = followOf(view.item) !== null;
  if (follows) {
    left.push(section(th('markets.book.title'), depthBody(depth.book, () => bookHtml(bookOf(depth.book.data), unit), t('markets.book.unavailable'), now,
      () => bookOf(depth.book.data).at)));
    left.push(section(th('markets.trades.title'), depthBody(depth.trades, () => tradesHtml(tradesOf(depth.trades.data), unit, now), t('markets.trades.unavailable'), now,
      () => tradesOf(depth.trades.data).trades[0]?.at ?? '')));
  }
  // a perpetual's funding: what was paid and received at its lines
  if (view.item.kind === 'perp') {
    // the one read at every venue that lists it, as the retired page reads it: the venues of the page's lines it could not
    // read said under the lines, Not read: …; Unavailable only when the read itself failed
    const connected = view.legs.filter(l => l.connected === true);
    const body = depth.funding.data;
    right.push(section(th('markets.funding.title'), depthBody(depth.funding, () => fundingHtml(fundingOf([body], connected.map(l => l.symbol)), now) +
      note(fundingMissingOf(body, connected.map(l => l.venue))), t('markets.funding.unavailable'), now)));
  }
  const about = aboutHtml(state.conversations, view.about, now);
  if (about.length) right.push(section(th('markets.about'), feed(about)));
  const stated = view.lines.map(l => line(DONE.has(l.status) ? '✓' : '·', esc([when(l.at, now), l.description, money(l.amountUsd)].filter(Boolean).join(' · ')),
    esc(statedWords(l)), DONE.has(l.status) ? 'ok' : ''));
  right.push(section(th('markets.statement.title'), partBody(view.reads.lines, stated, t('markets.statement.none'), t('account.statement.unavailable')),
    `<button type="button" class="link mk-link" data-action="openStatement">${th('markets.statement.open')}</button>`));
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
  const failed = h.status === 'error' ? note(h.message || t('markets.history.unavailable')) : '';
  const drawnNow = h.current ? (svg || note(t('markets.history.none'))) : h.status === 'loading' ? note(t('common.loading')) : '';
  return failed + drawnNow;
}

function cnPage(asset, state, now) {
  const m = state.markets;
  const view = cnPageOf(m, asset.id);
  const quote = view.quote;
  // starred as the press reads it (app.js toggles by watchedOf): the Account keys, the page's china entry, an old cn star
  const watched = watchedOf(m, asset.id, state.account?.data);
  const sub = [t('markets.cn.aShare'), asset.symbol, cnBoardOf(asset.symbol)].filter(Boolean).join(' · '); // words-order: an A share's facts under the visual separator
  const who = `<div class="mk-who">${mkAv(cnTileOf(asset.name, asset.symbol), 'lg')}<div><h1 class="head-title">${esc(asset.name || asset.symbol)}</h1><span class="mk-sub">${esc(sub)}</span></div></div>`;
  const priced = number(quote?.price) !== null;
  const stateWord = cnStateWord(quote, m.connection, m.providers);
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(price(quote?.price, asset.currency))}</span>` +
    `${priced ? `${chgHtml(number(quote.change_pct))}<span class="mk-basis">${esc(basisWord(quote))}</span>` : ''}</div>` +
    `${stateWord ? `<p class="mk-asof">${esc(stateWord)}</p>` : ''}${planHtml(markOf(state.desk?.data, asset.id))}` +
    `<dl class="mk-facts">${view.facts.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(factWord(f))}</dd></div>`).join('')}</dl>`;
  const left = [section(th('markets.history.title'), cnHistory(view), seg(candleRanges(), view.range, 'setRange', { 'data-id': asset.id }))];
  const about = aboutHtml(state.conversations, asset, now);
  return pageHtml(who, keysHtml(asset.id, watched), top, left, about.length ? [section(th('markets.about'), feed(about))] : []);
}

// ---- a local market's page (spec 2026-11-20 §5.6): a Hong Kong, Korean or Taiwanese share's, a cash index's — the A share's kind of
// page: its price in its currency (an index's level bare), its facts, its price history, Hand to gravit; no star, no ticket

// a session's minutes on the chart's grid, by venue: HKEX 09:30–12:00 and 13:00–16:00, KRX 09:00–15:30, TWSE 09:00–13:30; an index
// its longest session's points
const SESSION_MINUTES = { hk: 331, kr: 391, tw: 271, ix: 0 };

// a fact in its unit's words: a price in the market's currency (an index's level bare), a volume in shares, an amount in its currency,
// a word as it is; none is —
function localFactWord({ value: v, unit }, currency) {
  if (v === null || v === undefined || v === '') return EM;
  if (unit === 'price') return localPrice(v, currency);
  if (unit === 'amount') return localAmount(v, currency);
  if (unit === 'shares') return volumeWordOf({ volume: v, volumeUnit: 'shares' });
  return String(v);
}

// its price history at its range: 1D and 5D the sessions on its session's grid, longer the closes on their dates, in its currency; a
// refusal's sentence where the chart would be. Every source stamps a daily bar so that its Beijing date is the session's own date —
// Tencent's and Eastmoney's at 15:00 Beijing, Naver's at 15:30 UTC+9 (market/src/live/eastmoney.ts parseEmKline, index-parse.ts
// parseNaverIndexChart) — so a New York or European session's close is drawn on its own date, never the next day
function localHistory(view) {
  const h = view.history;
  const fmt = v => localPrice(v, view.asset.currency);
  const svg = !h.current ? ''
    : view.range === '1D' || view.range === '5D' ? sessionsSvg(view.range === '1D' ? (h.sessions ?? []).slice(-1) : h.sessions, { minutes: SESSION_MINUTES[view.asset.venue] ?? 0, fmt })
      : candlesSvg(h.candles, { zone: 'Asia/Shanghai', range: view.range, fmt });
  const failed = h.status === 'error' ? note(h.message || t('markets.history.unavailable')) : '';
  const drawnNow = h.current ? (svg || note(t('markets.history.none'))) : h.status === 'loading' ? note(t('common.loading')) : '';
  return failed + drawnNow;
}

function localPage(id, state, now) {
  const view = localPageOf(state.markets, id);
  if (!view) return '';
  const { asset, quote } = view;
  const share = asset.kind === 'share';
  const sub = (share ? [regionWord(asset.region), asset.symbol, asset.nameLocal] : [t('markets.local.index'), regionWord(asset.region)])
    .filter(Boolean).join(' · '); // words-order: a market's facts under the visual separator
  const who = `<div class="mk-who">${mkAv(Array.from(asset.name)[0] ?? asset.symbol, 'lg')}<div><h1 class="head-title">${esc(asset.name)}</h1><span class="mk-sub">${esc(sub)}</span></div></div>`;
  const priced = number(quote?.price) !== null;
  const stateWord = localStateWord(asset.venue, state.markets.connection, state.markets.providers);
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(localPrice(number(quote?.price), asset.currency))}</span>` +
    `${priced ? `${chgHtml(number(quote.change_pct))}<span class="mk-basis">${esc(basisWord(quote))}</span>` : ''}</div>` +
    `${stateWord ? `<p class="mk-asof">${esc(stateWord)}</p>` : ''}${planHtml(markOf(state.desk?.data, id))}` +
    `<dl class="mk-facts">${view.facts.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(localFactWord(f, asset.currency))}</dd></div>`).join('')}</dl>`;
  const left = [section(th('markets.history.title'), localHistory(view), seg(localCandleRanges(id), view.range, 'setRange', { 'data-id': id }))];
  const keys = `<div class="mk-d-acts"><button type="button" class="btn" data-action="handToGravit" data-id="${esc(id)}">${icon('agent', 16, 2)}${th('markets.hand')}</button></div>`; // words-order: an icon, then its word
  const about = aboutHtml(state.conversations, { symbol: asset.symbol, name: asset.name }, now);
  return pageHtml(who, keys, top, left, about.length ? [section(th('markets.about'), feed(about))] : []);
}

// ---- an option chain's page (spec 2026-11-22 §5.4): the underlying's price, the venue switch (a coin at Deribit or OKX), the expiry tabs,
// then the strikes — calls | strike | puts, each side's bid, ask, last, change, volume, open interest and IV, the at-the-money strike
// marked, the cells in the money shaded — with the source, the last trade and a partial read's note under the price. A crypto leg's
// prices are in the coin, its dollars under each (spec: the source's own figures; the dollars the market's, coin × the underlying). A
// refusal is the page's sentence in place of the table.

// a leg's price: in dollars (a US leg's, a USDC or USDT leg's) with its mark, in the coin as a bare number (the note says the unit);
// none is —
const legPrice = (v, unit) => (v === null ? EM : DOLLAR_UNITS.has(unit) ? price(v, 'USD') : Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 }));
const dollars = v => (v === null || v === undefined ? '' : price(v, 'USD'));
// a leg's change: its percent where the source gives one, else its change in the leg's unit, signed; none is —
function legChange(l) {
  const v = l.changePct ?? l.change;
  if (v === null || v === undefined) return `<span class="flat">${EM}</span>`;
  const word = l.changePct !== null ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : `${v > 0 ? '+' : ''}${legPrice(v, l.unit)}`;
  return `<span class="${tone(v)}">${esc(word)}</span>`;
}
const compactCount = v => (v === null || v === undefined ? EM : compactNumber(v));
// one side's seven cells: a crypto leg's bid, ask and last with their dollars under them; in the money shaded
function legCells(l, itm, coin) {
  const c = cls('r', itm && 'mk-itm');
  if (!l) return Array.from({ length: 7 }, () => `<td class="${c}"></td>`).join('');
  // a dollar-priced leg (USD, USDC, USDT) has no second dollar line
  const under = coin && !DOLLAR_UNITS.has(l.unit);
  const px = (v, usd) => `<td class="${c}">${esc(legPrice(v, l.unit))}${under && usd ? `<span class="mk-usd">${esc(usd)}</span>` : ''}</td>`;
  return px(l.bid, dollars(l.usd?.bid)) + px(l.ask, dollars(l.usd?.ask)) + px(l.last, dollars(l.usd?.last)) +
    `<td class="${c}">${legChange(l)}</td><td class="${c}">${esc(compactCount(l.volume))}</td><td class="${c}">${esc(compactCount(l.openInterest))}</td>` +
    `<td class="${c}">${esc(l.iv === null ? EM : `${l.iv.toFixed(1)}%`)}</td>`;
}
function chainTable(view) {
  const side = () => [th('markets.book.bid'), th('markets.book.ask'), th('markets.option.last'), th('markets.head.change'), th('markets.head.volume'), th('markets.option.oi'), th('markets.option.iv')]
    .map(w => `<th scope="col" class="r">${w}</th>`).join('');
  const head = `<tr><th scope="colgroup" colspan="7" class="mk-chain-side">${th('markets.option.calls')}</th><th scope="col" class="mk-strike">${th('markets.option.strike')}</th><th scope="colgroup" colspan="7" class="mk-chain-side">${th('markets.option.puts')}</th></tr>` +
    `<tr>${side()}<th scope="col" class="mk-strike"><span class="sr-only">${th('markets.option.strike')}</span></th>${side()}</tr>`;
  const k = v => esc(Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const strike = r => `<th scope="row" class="mk-strike">${r.atm ? `<span aria-hidden="true">▸ </span>${k(r.strike)}<span aria-hidden="true"> ◂</span><span class="sr-only"> ${th('markets.option.atm')}</span>` : k(r.strike)}</th>`; // words-order: the strike, then its mark
  const body = view.rows.map(r => `<tr${r.atm ? ' class="mk-atm"' : ''}>${legCells(r.call, r.callItm, view.coinPriced)}${strike(r)}${legCells(r.put, r.putItm, view.coinPriced)}</tr>`).join('');
  return `<div class="mk-wrap"><table class="mk-t mk-chain"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function optionPage(id, state) {
  const view = optionPageOf(state.markets, id);
  const who = `<div class="mk-who">${mkAv(view.underlying, 'lg')}<div><h1 class="head-title">${esc(view.name)}</h1>` +
    `<span class="mk-sub">${esc(view.venues.map(v => v.label).join(' · '))}</span></div></div>`; // words-order: the venues' names under the visual separator
  const moved = view.changePct !== null;
  const under = [view.quoteFrom, view.lastTrade].filter(Boolean).join(' · '); // words-order: the source, then its last trade, under the visual separator
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(priceWord(view.price, 'usd'))}</span>${moved ? `${moveHtml({ unit: 'usd', changePct: view.changePct })}<span class="mk-basis">24h</span>` : ''}</div>` +
    `${under ? `<p class="mk-asof">${esc(under)}</p>` : ''}${note(view.note)}`;
  const venue = view.switchable ? seg(view.venues.map(v => [v.label, v.id]), view.venue, 'optVenue', { 'data-id': id }) : '';
  const tabs = view.expiries.length ? seg(view.expiries.map(e => [e.label, e.id]), view.expiry, 'optExpiry', { 'data-id': id }) : '';
  // the strikes once the chain asked has answered; else how far its read has got, a refusal in the market's sentence
  const body = view.chain
    ? `${view.failedOver ? note(view.message) : ''}${view.chain.stale ? note(t('markets.asOfLast')) : ''}${view.coinPriced ? note(t('markets.option.pricesIn', { unit: view.unit })) : ''}${view.rows.length ? chainTable(view) : empty(t('markets.none'))}`
    : view.status === 'error' ? empty(view.message || t('markets.option.unavailable')) : empty(t('common.loading'));
  const keys = `<div class="mk-d-acts"><button type="button" class="btn" data-action="handToGravit" data-id="${esc(id)}">${icon('agent', 16, 2)}${th('markets.hand')}</button></div>`; // words-order: an icon, then its word
  return `<main class="main mkts mk-page"><a id="page-back" class="back-link page-back" href="#/markets">${th('markets.back')}</a><div class="mk-pg">` +
    `<header class="mk-pg-head">${who}${keys}</header><div class="mk-pg-top">${top}</div>` +
    section(th('markets.option.chain'), `<div class="mk-chain-picks">${venue}${tabs}</div>${body}`) + '</div></main>';
}

// ---- an index's page (spec 2026-11-22-markets-compute §5): Ornn's GPU rental or token price index — the latest settle with its unit and the
// change from the previous settle, the source line, the facts (the settle and its date, the previous settle, the 30-day high and low, a
// GPU's current value and its time), the market's notes, the daily settles over 1M or 3M; Hand to gravit, no star, no ticket

// a fact in its words: a price in dollars, with its settle's date or its value's time after it; none is —
function computeFactWord(f, now) {
  if (f.value === null || f.value === undefined) return EM;
  const at = f.at ? when(f.at, now) : '';
  return [computePrice(f.value), f.date ?? '', at].filter(Boolean).join(' · '); // words-order: a price, then its date or time, under the visual separator
}
function computeHistory(view) {
  const h = view.history;
  // a daily settle's date as Ornn stamps it (UTC), never the operator's clock
  const svg = h.current ? candlesSvg(h.candles, { zone: 'UTC', range: view.range, fmt: computePrice }) : '';
  const failed = h.status === 'error' ? note(h.message || t('markets.history.unavailable')) : '';
  const drawnNow = h.current ? (svg ? svg + note(h.note) : note(t('markets.history.none'))) : h.status === 'loading' ? note(t('common.loading')) : '';
  return failed + drawnNow;
}
function computePage(id, state, now) {
  const view = computePageOf(state.markets, id);
  if (!view) return '';
  const sub = [view.kind, ORNN].join(' · '); // words-order: an index's kind and its source under the visual separator
  const who = `<div class="mk-who">${mkAv(view.name.split(' ')[0], 'lg')}<div><h1 class="head-title">${esc(view.name)}</h1><span class="mk-sub">${esc(sub)}</span></div></div>`;
  const moved = view.changePct !== null && view.changePct !== undefined;
  // the quote not read: the market's sentence when it refused before any answer, else nothing until it answers
  const down = view.quote.status === 'error' ? note(view.quote.message || t('markets.compute.unavailable')) : '';
  const top = `<div class="mk-d-px"><span class="mk-big">${esc(computePrice(view.price))}</span><span class="mk-unit">${esc(view.perUnit)}</span>` +
    `${moved ? `${chgHtml(view.changePct)}<span class="mk-basis">${th('markets.compute.change')}</span>` : ''}</div>` +
    `${view.sourceLine ? `<p class="mk-asof">${esc(view.sourceLine)}</p>` : ''}${down}${view.notes.map(note).join('')}${planHtml(markOf(state.desk?.data, id))}` +
    (view.facts.length ? `<dl class="mk-facts">${view.facts.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(computeFactWord(f, now))}</dd></div>`).join('')}</dl>` : '');
  const left = [section(th('markets.history.title'), computeHistory(view), seg(computeCandleRanges(), view.range, 'setRange', { 'data-id': id }))];
  const keys = `<div class="mk-d-acts"><button type="button" class="btn" data-action="handToGravit" data-id="${esc(id)}">${icon('agent', 16, 2)}${th('markets.hand')}</button></div>`; // words-order: an icon, then its word
  const about = aboutHtml(state.conversations, { name: view.name }, now);
  return pageHtml(who, keys, top, left, about.length ? [section(th('markets.about'), feed(about))] : []);
}
