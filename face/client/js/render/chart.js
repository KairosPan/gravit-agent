// face/client/js/render/chart.js — a Market page's chart: /data/bars' daily closes as an area and a line in a 400×140
// box (the demo chart's geometry), the low and the high touching the margins, a label that says the range
import { esc } from '../html.js';
import { price, number } from '../wire/market-model.js';

const W = 400;
const H = 140;

export function chartSvg(rows, { currency } = {}) {
  const points = (Array.isArray(rows) ? rows : [])
    .map(r => ({ date: typeof r?.date === 'string' ? r.date : '', close: number(r?.close) }))
    .filter(p => p.close !== null);
  if (points.length < 2) return '';
  const closes = points.map(p => p.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const span = hi - lo || 1;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${((i * W) / (points.length - 1)).toFixed(1)},${(H - 6 - ((p.close - lo) / span) * (H - 12)).toFixed(1)}`).join('');
  const f = v => price(v, currency);
  const first = points[0].date;
  const last = points.at(-1).date;
  const label = `Daily closes from ${first} to ${last}: from ${f(closes[0])} to ${f(closes.at(-1))}, low ${f(lo)}, high ${f(hi)}`;
  return `<svg class="mk-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">` +
    `<path class="mk-chart-area" d="${line}L${W},${H}L0,${H}Z"></path><path class="mk-chart-line" d="${line}"></path></svg>` +
    `<div class="mk-axis"><span>${esc(first)}</span><span>Low ${esc(f(lo))} · High ${esc(f(hi))}</span><span>${esc(last)}</span></div>`;
}
