// face/client/js/render/lunhui/stock.js — the stock drawer (plan 3 of the Lunhui run view, task 4; spec §5.4): one pool name
// of the opening answer's view, on the right — its header, the pool line, its minute line against the view's own limits (the
// limit lines, the seal marks, volume bars, the slider and its readout) with a derived headline and a note, the tiles, the
// run's claims that cite it, and Ask Gravit / Open in Markets. Every number comes from the view; every word it holds is escaped.
import { esc, attrs, cls } from '../../html.js';
import { yuan, fix2, signedPct, count } from './block.js';
import { intradaySvg, cursorPatch, minuteLabel, sealIndex, atLimitUp, atLimitDown, limitsOf, includesUp } from './intraday.js';
import { chinaStamp } from './time.js';
import { boardOf } from '../../host/lunhui.js';

const fin = v => v != null && v !== '' && Number.isFinite(Number(v));
const word = v => (v == null || v === '' ? '—' : String(v));
const n = v => (fin(v) ? count(Number(v)) : '—');
const pctText = v => (fin(v) ? signedPct(Number(v)) : '—');
const priceOf = f => (Array.isArray(f?.minutes?.price) ? f.minutes.price.map(Number) : []);
const hasLine = f => priceOf(f).length > 0;
// the change against the minute line's previous close
const pctAt = (f, p) => { const prec = Number(f.minutes.prec); return prec > 0 && fin(p) ? (p - prec) / prec * 100 : null; };

/** The pool tag: limit-up · n boards / broke · n-board try / yesterday's n-board. */
export function poolTag(f) {
  if (f?.pool === 'zt') return `limit-up · ${n(f.boards)} boards`;
  if (f?.pool === 'zb') return `broke · ${n(f.tried)}-board try`;
  return `yesterday's ${n(f?.yesterdayBoards)}-board`;
}

// the first grid minute from which every later minute is at the limit-up, or null when the close is not
function heldFrom(f, price) {
  let i = price.length;
  while (i > 0 && atLimitUp(price[i - 1], f)) i -= 1;
  return i < price.length ? i : null;
}
const firstAt = (f, price) => { const i = price.findIndex(p => atLimitUp(p, f)); return i < 0 ? null : i; };

/** The minute line's headline, derived from the line where one exists; the pool tag without one. */
export function stockHeadline(f) {
  const price = priceOf(f);
  if (!price.length) return poolTag(f);
  if (f.pool === 'zt') {
    if (!(Number(f.breaks) > 0)) return `Sealed ${word(f.firstSeal)} and held to the close`;
    const from = heldFrom(f, price);
    return `Sealed ${word(f.firstSeal)}, broke ${n(f.breaks)}×` + (from === null ? '' : `, held from ${minuteLabel(from)} to the close`);
  }
  if (f.pool === 'zb') {
    const first = firstAt(f, price);
    return first === null ? `Touched the limit at ${word(f.firstSeal)} and broke` : `Touched the limit at ${minuteLabel(first)}, broke, open at the close`;
  }
  let hi = 0;
  for (let i = 1; i < price.length; i++) if (price[i] > price[hi]) hi = i;
  const last = price[price.length - 1];
  return `Yesterday's ${n(f.yesterdayBoards)}-board: high ${pctText(pctAt(f, price[hi]))} at ${minuteLabel(hi)}, closed ${pctText(pctAt(f, last))}` +
    (atLimitDown(last, f) ? ' at the limit-down' : '');
}

/** The note line under the minute line, or null when there is nothing the line does not already say. */
export function stockNote(f) {
  const price = priceOf(f);
  if (!price.length) {
    const firstBoard = (f?.pool === 'zt' && Number(f.boards) === 1) || (f?.pool === 'zb' && Number(f.tried) === 1);
    return firstBoard ? 'no minute line frozen for first boards' : `no minute line frozen (${word(f?.minutesMissing ?? 'NOT_FROZEN')})`;
  }
  if ((f.pool === 'zt' || f.pool === 'zb') && Number(f.breaks) > 0) {
    const from = sealIndex(f.firstSeal);
    if (from !== null && from < price.length && price.slice(from).every(p => atLimitUp(p, f))) {
      return 'each break fell inside a minute, so the minute line never leaves the limit';
    }
  }
  if (f.pool === 'zb' && firstAt(f, price) === null) return `touched ${word(f.firstSeal)} and broke; no minute closed at the limit`;
  return null;
}

const tone = v => (!fin(v) || Number(Number(v).toFixed(2)) === 0 ? 'grey' : Number(v) < 0 ? 'down' : 'up');
const tile = (k, v) => `<div class="lh-stat"><span class="lh-stat-k">${esc(k)}</span><span class="lh-stat-v">${esc(v)}</span></div>`;
const sec = (title, body) => `<div class="dsec"><div class="dsec-label">${esc(title)}</div>${body}</div>`;

function shell(name, body, sub = '') {
  return `<aside${attrs({ class: 'drawer stock', 'aria-label': name })}><div class="drawer-head">` +
    `<div class="lh-stk-head"><h2>${esc(name)}</h2>${sub ? `<div class="lh-stk-sub">${esc(sub)}</div>` : ''}</div>` +
    `<button type="button" class="close-key" data-action="lunhuiStockClose" aria-label="Close">×</button></div>` +
    `<div class="drawer-body">${body}</div></aside>`;
}

function minuteLine(view, f) {
  const note = stockNote(f);
  const noteHtml = note ? `<div class="lh-stk-note">${esc(note)}</div>` : '';
  const head = `<div class="lh-title">${esc(stockHeadline(f))}</div>`;
  if (!hasLine(f)) return head + noteHtml;
  const id = `s-${f.code}`;
  const last = priceOf(f).length - 1;
  const where = { 'data-id': id, 'data-strategy': view.strategy ?? '', 'data-run': view.run ?? '', 'data-symbol': f.symbol ?? f.code ?? '' };
  // the same limits and domain the live cursor (cursorPatch) uses, so the two agree
  const svg = intradaySvg(f.minutes, { minute: last, id, limits: limitsOf(f), includeUp: includesUp(f), seals: { first: f.firstSeal, last: f.lastSeal }, bars: 'volume' })
    .replace(/^<svg class="lh-chart"/, `<svg class="lh-chart"${attrs({ 'data-action': 'lunhuiHover', 'data-last': String(last), ...where })}`);
  const slider = `<input${attrs({ type: 'range', id: `minute-${id}`, class: 'lh-minute', 'data-action': 'lunhuiMinute', ...where, min: '0', max: String(last), value: String(last), step: '1', 'aria-label': `Minute on ${f.name ?? f.code}` })}>`;
  const words = cursorPatch(view, f.symbol ?? f.code, last)?.readout ?? '';
  return head + svg + slider + `<div class="lh-readout" id="read-${esc(id)}" role="status" aria-live="polite">${esc(words)}</div>` + noteHtml;
}

function tiles(f) {
  const own = f.pool === 'zt' ? [tile('Seal funds', yuan(f.sealFunds)), tile('Limit price', fin(f.limitPrice ?? f.limitUp) ? fix2(f.limitPrice ?? f.limitUp) : '—')]
    : f.pool === 'zb' ? [tile('Limit price', fin(f.limitPrice) ? fix2(f.limitPrice) : '—')]
    : [tile("Yesterday's boards", n(f.yesterdayBoards))];
  return `<div class="lh-stats">${own.join('')}${tile('Turnover', fin(f.turnover) ? `${fix2(f.turnover)}%` : '—')}${tile('Amount', yuan(f.amount))}</div>`;
}

function cited(f) {
  const list = Array.isArray(f.cited) ? f.cited.filter(c => c && typeof c === 'object') : [];
  if (!list.length) return '<div class="lh-none">No claim cites it; it is in the limit-up pool only.</div>';
  return list.map(c => `<div class="lh-stk-cite"><span class="lh-id">${esc(`${word(c.module)} · ${word(c.id)}`)}</span>${esc(c.text ?? '')}</div>`).join('');
}

/** The stock drawer for the open stock (state.lunhui.stock) on its answer's view; '' when none is open. */
export function stockDrawerHtml(state) {
  const open = state?.lunhui?.stock;
  if (!open || typeof open.code !== 'string') return '';
  const code = open.code;
  const entry = state.lunhui.views?.[open.key];
  if (!entry || entry.status === 'loading') return shell(code, `<div class="lh-none">${esc(`Loading ${code}…`)}</div>`);
  if (entry.status === 'failed') return shell(code, `<div class="lh-error">${esc(word(entry.error))}</div>`);
  const view = entry.view ?? {};
  const f = view.stocks && typeof view.stocks === 'object' && Object.hasOwn(view.stocks, code) ? view.stocks[code] : null;
  if (!f) return shell(code, `<div class="lh-none">${esc(`${code} is not in this run's pools.`)}</div>`);
  const name = f.name ?? code;
  const sub = [code, boardOf(code), f.industry].filter(x => typeof x === 'string' && x !== '').join(' · ');
  const pool = `<div class="lh-stk-pool"><span class="lh-stk-price">${fin(f.price) ? fix2(f.price) : '—'}</span>` +
    `<span class="${cls('chip', tone(f.pct))}">${esc(pctText(f.pct))}</span><span class="lh-stk-tag">${esc(poolTag(f))}</span></div>` +
    `<div class="lh-stk-from">${esc(`From the limit-up pool frozen ${chinaStamp(view.frozenAt)} by the market run`)}</div>`;
  const keys = `<div class="btn-row">` +
    `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': 'lunhuiAsk', 'data-code': code })}>${esc(`Ask Gravit about ${name}`)}</button>` +
    `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': 'lunhuiMarkets', 'data-code': code })}>Open in Markets</button></div>`;
  return shell(name, pool + sec('The minute line', minuteLine(view, f)) + tiles(f) + sec('In this run', cited(f)) + keys, sub);
}

/** The words Ask Gravit sends about the open stock, or null when no stock of a loaded view is open. */
export function askText(state) {
  const open = state?.lunhui?.stock;
  const entry = open ? state.lunhui.views?.[open.key] : null;
  const f = entry?.status === 'loaded' && entry.view?.stocks && Object.hasOwn(entry.view.stocks, open.code) ? entry.view.stocks[open.code] : null;
  return f ? `说说 ${f.name ?? open.code}（${open.code}）在这次运行里的情况。` : null;
}
