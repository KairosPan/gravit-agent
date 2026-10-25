// face/client/js/render/chart.js — the charts, each an area and a line in a 400×140 box (the demo chart's geometry), the low
// and the high touching the margins, a label that says the range: a market's closes from the Account's candles read, and the
// Account's net-worth curve from its history read
import { esc } from '../html.js';
import { price, number } from '../wire/market-model.js';
import { fmtClock, fmtDate } from '../time.js';

const W = 400;
const H = 140;

// the values evenly spaced across the box, the svg with its label, and the axis: the two ends and the range between
function drawn(values, { label, first, last, f }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${((i * W) / (values.length - 1)).toFixed(1)},${(H - 6 - ((v - lo) / span) * (H - 12)).toFixed(1)}`).join('');
  const said = `${label}: from ${f(values[0])} to ${f(values.at(-1))}, low ${f(lo)}, high ${f(hi)}`;
  return `<svg class="mk-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(said)}">` +
    `<path class="mk-chart-area" d="${line}L${W},${H}L0,${H}Z"></path><path class="mk-chart-line" d="${line}"></path></svg>` +
    `<div class="mk-axis"><span>${esc(first)}</span><span>Low ${esc(f(lo))} · High ${esc(f(hi))}</span><span>${esc(last)}</span></div>`;
}

// a point's time as the axis says it, on the operator's clock (Oct 15 09:30); one that does not parse is no time
const clockWord = t => `${fmtDate(t)} ${fmtClock(t)}`;
const timeWord = at => { const t = Date.parse(at); return Number.isNaN(t) ? '' : clockWord(t); };
// a bar's start, in ms, when it names a moment a date can hold; anything else is no time
const msOf = v => { const t = number(v); return t !== null && !Number.isNaN(new Date(t).getTime()) ? t : null; };

/** A market's price history from the Account's candles read: its bars ({ t, o, h, l, c } — `t` a bar's start in ms — oldest
 *  first, as the Account sends them) drawn as their closes over the range, in the charts' box, the axis at the first and
 *  last bars' times; an event contract's closes, dollars a contract, in cents when the unit says so. A bar without a close or a
 *  time is left out; fewer than two draw nothing. */
export function candlesSvg(candles, { unit, range } = {}) {
  const kept = (Array.isArray(candles) ? candles : [])
    .map(b => ({ t: msOf(b?.t), c: number(b?.c) }))
    .filter(b => b.c !== null && b.t !== null);
  if (kept.length < 2) return '';
  const cents = unit === 'cents';
  const f = cents ? v => `${Number(v.toFixed(1))}¢` : v => price(v, 'USD');
  return drawn(kept.map(b => (cents ? b.c * 100 : b.c)), {
    label: range ? `Closes over ${range}` : 'Closes', first: clockWord(kept[0].t), last: clockWord(kept.at(-1).t), f,
  });
}

/** A figure of the Account's over the curve's range — Net worth, or Paper as the renderer names the figure the curve draws:
 *  its history points ({ at, usd }, oldest first, as the Account sends them), a point without a number or a time left out,
 *  in the charts' box; fewer than two points draw nothing. */
export function curveSvg(points, { currency, label = 'Net worth' } = {}) {
  const kept = (Array.isArray(points) ? points : [])
    .map(p => ({ at: timeWord(p?.at), usd: number(p?.usd) }))
    .filter(p => p.usd !== null && p.at !== '');
  if (kept.length < 2) return '';
  const first = kept[0].at;
  const last = kept.at(-1).at;
  return drawn(kept.map(p => p.usd), { label: `${label} from ${first} to ${last}`, first, last, f: v => price(v, currency) });
}
