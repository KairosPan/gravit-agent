// face/client/js/render/chart.js — the charts, each an area and a line in a 400×140 box (the demo chart's geometry), the low
// and the high touching the margins, a label that says the range: a market's closes from the Account's candles read, and the
// Account's net-worth curve from its history read
import { esc } from '../html.js';
import { price, number } from '../wire/market-model.js';
import { fmtClock, fmtDate } from '../time.js';
import { t, th } from '../i18n/words.js';

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
const clockWord = ms => `${fmtDate(ms)} ${fmtClock(ms)}`;
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
  const described = t('markets.chart.sessions', { n: kept.length, first, last, low: f(lo), high: f(hi) });
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
