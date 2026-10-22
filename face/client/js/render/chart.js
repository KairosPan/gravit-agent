// face/client/js/render/chart.js — the charts, each an area and a line in a 400×140 box (the demo chart's geometry), the low
// and the high touching the margins, a label that says the range: a Market page's daily closes from /data/bars, and the
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

export function chartSvg(rows, { currency } = {}) {
  const points = (Array.isArray(rows) ? rows : [])
    .map(r => ({ date: typeof r?.date === 'string' ? r.date : '', close: number(r?.close) }))
    .filter(p => p.close !== null);
  if (points.length < 2) return '';
  const first = points[0].date;
  const last = points.at(-1).date;
  return drawn(points.map(p => p.close), { label: `Daily closes from ${first} to ${last}`, first, last, f: v => price(v, currency) });
}

// a point's time as the axis says it, on the operator's clock (Oct 15 09:30); one that does not parse is no time
const timeWord = at => { const t = Date.parse(at); return Number.isNaN(t) ? '' : `${fmtDate(t)} ${fmtClock(t)}`; };

/** A figure of the Account's over the curve's range — Net worth, or Paper as the renderer names the figure the curve draws:
 *  its history points ({ at, usd }, oldest first, as the Account sends them), a point without a number or a time left out,
 *  in the closes chart's box; fewer than two points draw nothing. */
export function curveSvg(points, { currency, label = 'Net worth' } = {}) {
  const kept = (Array.isArray(points) ? points : [])
    .map(p => ({ at: timeWord(p?.at), usd: number(p?.usd) }))
    .filter(p => p.usd !== null && p.at !== '');
  if (kept.length < 2) return '';
  const first = kept[0].at;
  const last = kept.at(-1).at;
  return drawn(kept.map(p => p.usd), { label: `${label} from ${first} to ${last}`, first, last, f: v => price(v, currency) });
}
