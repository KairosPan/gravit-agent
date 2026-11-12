// face/client/js/render/chart.js — the charts, each an area and a line in a 400×140 box (the demo chart's geometry), the low
// and the high touching the margins, a label that says the range: a market's closes from the Account's candles read, and the
// Account's net-worth curve from its history read; and a stock's window at an event (analog event table Task 9) as daily candles
// in a box of its own, with the line against the market under them
import { esc } from '../html.js';
import { price, number } from '../wire/market-model.js';
import { fmtClock, fmtDate } from '../time.js';
import { t, th, tn } from '../i18n/words.js';
import { nyDay } from '../host/event-window.js';

const W = 400;
const H = 140;

// the values evenly spaced across the box, the svg with its label, and the axis: the two ends and the range between
function drawn(values, { label, first, last, f }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${((i * W) / (values.length - 1)).toFixed(1)},${(H - 6 - ((v - lo) / span) * (H - 12)).toFixed(1)}`).join('');
  const described = t('markets.chart.said', { label, from: f(values[0]), to: f(values.at(-1)), low: f(lo), high: f(hi) });
  return `<svg class="mk-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(described)}">` +
    `<path class="mk-chart-area" d="${line}L${W},${H}L0,${H}Z"></path><path class="mk-chart-line" d="${line}"></path></svg>` +
    `<div class="mk-axis"><span>${esc(first)}</span><span>${th('markets.chart.lowHigh', { low: f(lo), high: f(hi) })}</span><span>${esc(last)}</span></div>`;
}

// a point's time as the axis says it, on the operator's clock (Oct 15 09:30); one that does not parse is no time
const clockWord = ms => t('time.dayClock', { day: fmtDate(ms), clock: fmtClock(ms) });
const timeWord = at => { const ms = Date.parse(at); return Number.isNaN(ms) ? '' : clockWord(ms); };
// a bar's start, in ms, when it names a moment a date can hold; anything else is no time
const msOf = v => { const ms = number(v); return ms !== null && !Number.isNaN(new Date(ms).getTime()) ? ms : null; };

/** A market's price history from the Account's candles read: its bars ({ t, o, h, l, c } — `t` a bar's start in ms — oldest
 *  first, as the Account sends them) drawn as their closes over the range, in the charts' box, the axis at the first and
 *  last bars' times; an event contract's closes, dollars a contract, in cents when the unit says so. A bar without a close or a
 *  time is left out; fewer than two draw nothing. */
export function candlesSvg(candles, { unit, range, zone } = {}) {
  const kept = (Array.isArray(candles) ? candles : [])
    .map(b => ({ t: msOf(b?.t), c: number(b?.c) }))
    .filter(b => b.c !== null && b.t !== null);
  if (kept.length < 2) return '';
  const cents = unit === 'cents';
  const f = cents ? v => `${Number(v.toFixed(1))}¢` : v => price(v, unit === 'cny' ? 'CNY' : 'USD');
  // an A share's bars (spec 2026-10-31 §5): their dates in the market's own zone, never the operator's clock
  const end = zone ? ms => dateIn(ms, zone) : clockWord;
  return drawn(kept.map(b => (cents ? b.c * 100 : b.c)), {
    label: range ? t('markets.chart.closesOver', { range }) : t('markets.chart.closes'), first: end(kept[0].t), last: end(kept.at(-1).t), f,
  });
}

// a moment's date in a zone, `YYYY-MM-DD`
const dateIn = (ms, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

const SESSION = 242;   // an A-share session's minutes on the grid: 09:30–11:30 and 13:00–15:00

/** An A share's last sessions minute by minute (5D, spec 2026-10-31 §5): every session on one fixed grid of 242 points each, so a
 *  session still trading fills only its part; the previous close before the first session dashed; a separator between sessions;
 *  every session's date (`MM-DD`) on the axis, the low and the high in yuan under it. Fewer than two prices draw nothing. */
export function sessionsSvg(sessions) {
  const kept = (Array.isArray(sessions) ? sessions : []).filter(x => Array.isArray(x?.price) && x.price.length);
  const prices = kept.flatMap(x => x.price.map(Number)).filter(Number.isFinite);
  if (kept.length === 0 || prices.length < 2) return '';
  const prec = number(kept[0].prec);
  const lo = Math.min(...prices, ...(prec !== null ? [prec] : []));
  const hi = Math.max(...prices, ...(prec !== null ? [prec] : []));
  const span = hi - lo || 1;
  const slots = Math.max(2, SESSION * kept.length);
  const X = i => ((i * W) / (slots - 1)).toFixed(1);
  const Y = v => (H - 6 - ((v - lo) / span) * (H - 12)).toFixed(1);
  const points = kept.flatMap((x, k) => x.price.map((v, i) => [k * SESSION + i, Number(v)])).filter(([, v]) => Number.isFinite(v));
  const line = points.map(([i, v], n) => `${n ? 'L' : 'M'}${X(i)},${Y(v)}`).join('');
  const seps = kept.slice(1).map((_, k) => `<line class="mk-chart-sep" x1="${X((k + 1) * SESSION)}" y1="0" x2="${X((k + 1) * SESSION)}" y2="${H}"></line>`).join('');
  const prev = prec !== null ? `<line class="mk-chart-prev" x1="0" y1="${Y(prec)}" x2="${W}" y2="${Y(prec)}"></line>` : '';
  const f = v => price(v, 'CNY');
  const day = d => (typeof d === 'string' ? d.slice(5) : '');
  const first = day(kept[0].date), last = day(kept.at(-1).date);
  const described = tn('markets.chart.sessions', kept.length, { first, last, low: f(lo), high: f(hi) });
  return `<svg class="mk-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(described)}">${seps}${prev}` +
    `<path class="mk-chart-area" d="${line}L${X(points.at(-1)[0])},${H}L0,${H}Z"></path><path class="mk-chart-line" d="${line}"></path></svg>` +
    `<div class="mk-axis">${kept.map(x => `<span>${esc(day(x.date))}</span>`).join('')}</div>` +
    `<div class="mk-axis"><span></span><span>${th('markets.chart.lowHigh', { low: f(lo), high: f(hi) })}</span><span></span></div>`;
}

/** A figure of the Account's over the curve's range — Net worth, or Paper as the renderer names the figure the curve draws:
 *  its history points ({ at, usd }, oldest first, as the Account sends them), a point without a number or a time left out,
 *  in the charts' box; fewer than two points draw nothing. */
export function curveSvg(points, { currency, label = t('account.worth.net') } = {}) {
  const kept = (Array.isArray(points) ? points : [])
    .map(p => ({ at: timeWord(p?.at), usd: number(p?.usd) }))
    .filter(p => p.usd !== null && p.at !== '');
  if (kept.length < 2) return '';
  const first = kept[0].at;
  const last = kept.at(-1).at;
  return drawn(kept.map(p => p.usd), { label: t('markets.chart.curve', { label, first, last }), first, last, f: v => price(v, currency) });
}

// ---- an event's window (analog event table Task 9): daily candles in their own box, wide enough for text, drawn to scale
const EW = 640, EH = 260;
const EL = 4, ER = 60, ET = 34, EB = 22;   // margins: the prices on the right, two rows of mark labels above, the dates below
const RH = 110, RT = 8, RB = 8;             // the line against the market under it, on the same bars
const fx1 = v => v.toFixed(1);
// a bar's centre on the window's width of `n` bars, and the width of one
const slotOf = n => (EW - EL - ER) / n;
const centreOf = (i, n) => EL + slotOf(n) * (i + 0.5);
// a chip's width for its words: a wide (CJK) character counts double
const textWidth = s => [...s].reduce((w, ch) => w + (/[⺀-￯]/.test(ch) ? 11 : 6.2), 0);
// a label's anchor: near the right edge it ends at its line, else starts there
const anchorAt = x => (x > EW * 0.7 ? { x: x - 3, a: 'end' } : { x: x + 3, a: 'start' });
const MMDD = ms => nyDay(ms).slice(5);

/** An event's window as daily candles ({ t, o, h, l, c } oldest first, as eventWindowOf keeps them): a body and a wick per bar,
 *  `up` when it closed at or above its open, else `down`; five price lines with their prices on the right; about seven date
 *  ticks (`MM-DD`, its New York day); day 0 (`day0`, an index) a light band and a solid line labelled with its date and the
 *  `day0` mark's label; each `other` mark a dashed line labelled as given; each flag ({ index, label, text, tone }) a chip
 *  near the bottom reading `label text`. A mark or flag off the bars is left out; fewer than two bars draw nothing. */
export function eventCandlesSvg(bars, { day0, marks = [], flags = [], unit } = {}) {
  const kept = Array.isArray(bars) ? bars : [];
  const n = kept.length;
  if (n < 2) return '';
  const ohlc = kept.map(b => [number(b?.o), number(b?.h), number(b?.l), number(b?.c)]);
  const whole = ohlc.filter(v => v.every(x => x !== null));
  if (whole.length < 2) return '';
  const lo = Math.min(...whole.map(v => v[2]));
  const hi = Math.max(...whole.map(v => v[1]));
  const span = hi - lo || 1;
  const plotH = EH - ET - EB;
  const Y = v => ET + ((hi - v) / span) * plotH;
  const slot = slotOf(n);
  const bodyW = Math.max(1, slot * 0.6);
  const f = v => price(v, unit === 'cny' ? 'CNY' : 'USD');
  const within = i => Number.isInteger(i) && i >= 0 && i < n;

  const grid = [0, 1, 2, 3, 4].map(k => {
    const v = lo + (span * k) / 4;
    const y = fx1(Y(v));
    return `<line class="ew-grid" x1="${EL}" y1="${y}" x2="${EW - ER}" y2="${y}"></line><text class="ew-price" x="${EW - ER + 4}" y="${fx1(Y(v) + 3)}">${esc(f(v))}</text>`;
  }).join('');
  const step = Math.max(1, Math.round(n / 7));
  // the first tick starts at the left edge, so it is never cut
  const ticks = kept.map((b, i) => (i % step === 0 && Number.isFinite(b?.t)
    ? `<text class="ew-tick" x="${i === 0 ? EL : fx1(centreOf(i, n))}" y="${EH - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(MMDD(b.t))}</text>` : '')).join('');
  const candles = ohlc.map(([o, h, l, c], i) => {
    if ([o, h, l, c].some(x => x === null)) return '';
    const dir = c >= o ? 'up' : 'down';
    const x = centreOf(i, n);
    const top = Y(Math.max(o, c));
    return `<line class="ew-wick ${dir}" x1="${fx1(x)}" y1="${fx1(Y(h))}" x2="${fx1(x)}" y2="${fx1(Y(l))}"></line>` +
      `<rect class="ew-body ${dir}" x="${fx1(x - bodyW / 2)}" y="${fx1(top)}" width="${fx1(bodyW)}" height="${fx1(Math.max(1, Y(Math.min(o, c)) - top))}"></rect>`;
  }).join('');
  const list = v => (Array.isArray(v) ? v : []);
  let day = '';
  if (within(day0)) {
    const x = centreOf(day0, n);
    const own = list(marks).find(m => m?.kind === 'day0' && m.index === day0);
    const label = [Number.isFinite(kept[day0]?.t) ? MMDD(kept[day0].t) : '', typeof own?.label === 'string' ? own.label : ''].filter(Boolean).join(' ');
    const { x: lx, a } = anchorAt(x);
    day = `<rect class="ew-band" x="${fx1(x - slot / 2)}" y="${ET}" width="${fx1(slot)}" height="${plotH}"></rect>` +
      `<line class="ew-day0" x1="${fx1(x)}" y1="${ET - 6}" x2="${fx1(x)}" y2="${ET + plotH}"></line>` +
      `<text class="ew-day0-label" x="${fx1(lx)}" y="12" text-anchor="${a}">${esc(label)}</text>`;
  }
  const others = list(marks).filter(m => m?.kind === 'other' && within(m.index)).map(m => {
    const x = centreOf(m.index, n);
    const { x: lx, a } = anchorAt(x);
    return `<line class="ew-mark" x1="${fx1(x)}" y1="${ET - 6}" x2="${fx1(x)}" y2="${ET + plotH}"></line>` +
      `<text class="ew-mark-label" x="${fx1(lx)}" y="26" text-anchor="${a}">${esc(typeof m.label === 'string' ? m.label : '')}</text>`;
  }).join('');
  const chips = list(flags).filter(g => within(g?.index)).map(g => {
    const words = `${g.label ?? ''} ${g.text ?? ''}`.trim();
    const w = textWidth(words) + 12;
    const x = Math.min(Math.max(EL, centreOf(g.index, n) - w / 2), EW - ER - w);
    const y = ET + plotH - 20;
    const tone = ['up', 'down', 'flat'].includes(g.tone) ? g.tone : 'none';
    return `<g class="ew-flag ${tone}"><rect x="${fx1(x)}" y="${y}" width="${fx1(w)}" height="16" rx="8"></rect>` +
      `<text x="${fx1(x + w / 2)}" y="${y + 12}" text-anchor="middle">${esc(words)}</text></g>`;
  }).join('');
  const first = Number.isFinite(kept[0]?.t) ? nyDay(kept[0].t) : '';
  const last = Number.isFinite(kept.at(-1)?.t) ? nyDay(kept.at(-1).t) : '';
  const described = t('markets.event.said', { first, last, low: f(lo), high: f(hi) });
  return `<svg class="ew-chart" viewBox="0 0 ${EW} ${EH}" role="img" aria-label="${esc(described)}">${grid}${day}${others}${candles}${chips}${ticks}</svg>`;
}

/** The line against the market under an event's candles: the case's `rel` ([k, v] pairs, k sessions from day 0, the day
 *  before = 100) on the same `count` bars as the candles, day 0 at `day0`; a dashed 100 with its figure, the low and the
 *  high beside it; day 0's line. A point off the bars is left out; fewer than two draw nothing. */
export function eventRelSvg(rel, { day0, count } = {}) {
  if (!Number.isInteger(day0) || !Number.isInteger(count) || count < 2) return '';
  const points = (Array.isArray(rel) ? rel : [])
    .map(p => { const k = Array.isArray(p) ? number(p[0]) : null; return [k === null ? NaN : day0 + k, Array.isArray(p) ? number(p[1]) : null]; })
    .filter(([i, v]) => Number.isInteger(i) && i >= 0 && i < count && v !== null);
  if (points.length < 2) return '';
  const values = points.map(([, v]) => v);
  const lo = Math.min(...values, 100);
  const hi = Math.max(...values, 100);
  const span = hi - lo || 1;
  const Y = v => RT + ((hi - v) / span) * (RH - RT - RB);
  const line = points.map(([i, v], k) => `${k ? 'L' : 'M'}${fx1(centreOf(i, count))},${fx1(Y(v))}`).join('');
  const x = fx1(centreOf(day0, count));
  const figure = (v, cls) => `<text class="${cls}" x="${EW - ER + 4}" y="${fx1(Y(v) + 3)}">${esc(String(Math.round(v)))}</text>`;
  const ends = [hi, lo].filter(v => Math.abs(Y(v) - Y(100)) > 10).map(v => figure(v, 'ew-price')).join('');
  const described = t('markets.event.relSaid', { low: Math.round(lo), high: Math.round(hi) });
  return `<svg class="ew-rel" viewBox="0 0 ${EW} ${RH}" role="img" aria-label="${esc(described)}">` +
    `<line class="ew-rel-base" x1="${EL}" y1="${fx1(Y(100))}" x2="${EW - ER}" y2="${fx1(Y(100))}"></line>${figure(100, 'ew-price')}${ends}` +
    `<line class="ew-day0" x1="${x}" y1="${RT}" x2="${x}" y2="${RH - RB}"></line><path class="ew-rel-line" d="${line}"></path></svg>`;
}
