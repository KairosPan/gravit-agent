// face/client/js/render/lunhui/intraday.js — an index's day minute by minute (plan 2 of the Lunhui run view, task 6): the
// chart's geometry over the session's 242-point grid, the intraday SVG (the previous close dashed, the price line and the
// minute's amount in the minute's colour, the high and the low, Gravit's focus band, the cursor), the row's sparkline, and
// the cursor's patch the slider and the pointer apply in place.
//
// Every time drawn comes from the grid (minuteLabel, a copy of the plugin's lib/market.mjs one: the client cannot import the
// plugin), never from a Date in the browser's zone: 09:30–11:30 are points 0–120, 13:00–15:00 are 121–241, China time.
import { esc } from '../../html.js';
import { yuan, signedPct, fix2 } from './block.js';

const LAST = 241;
const W = 760, H = 236, LEFT = 56, PLOT = 652, MID = 118, HALF = 108;
const TOP = MID - HALF, BOTTOM = MID + HALF;
const BARS = 36;   // the tallest minute's amount bar, from the bottom edge up

/** A grid index to its "HH:MM" label (China time). */
export function minuteLabel(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index > LAST) return '—';
  const t = index <= 120 ? 570 + index : 780 + index - 121;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/** "HH:MM" (China time) to its grid index, or null off the grid. */
export function minuteIndex(hhmm) {
  const m = typeof hhmm === 'string' ? /^(\d{2}):(\d{2})$/.exec(hhmm) : null;
  if (!m) return null;
  const t = Number(m[1]) * 60 + Number(m[2]);
  if (t >= 570 && t <= 690) return t - 570;
  if (t >= 780 && t <= 900) return t - 780 + 121;
  return null;
}

const prices = minutes => (Array.isArray(minutes?.price) ? minutes.price.map(Number) : []);
// one decimal in the markup, no trailing zero ("56", "545.7")
const n1 = v => Number(Number(v).toFixed(1));

/** The chart's geometry: X over the grid's 242 points, Y about the previous close with the day's farthest move plus 8%. */
export function chartGeometry(minutes) {
  const prec = Number(minutes?.prec);
  const far = Math.max(0, ...prices(minutes).filter(Number.isFinite).map(p => Math.abs(p - prec)));
  // a flat day still needs a span: a thousandth of the close, or 1
  const span = far > 0 ? far * 1.08 : (Math.abs(prec) > 0 ? Math.abs(prec) * 0.001 : 1);
  return { X: i => LEFT + i / LAST * PLOT, Y: p => MID - (p - prec) / span * HALF, span };
}

// each minute's direction against the one before it (the first against the previous close)
const directions = (price, prec) => price.map((p, i) => (p >= (i === 0 ? prec : price[i - 1]) ? 'up' : 'down'));

// the price line, cut where its direction turns; each run starts at the point the last one ended
function paths(price, dir, g) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= price.length; i++) {
    if (i < price.length && dir[i] === dir[start]) continue;
    const from = Math.max(0, start - 1);
    const pts = price.slice(from, i).map((p, k) => `${n1(g.X(from + k))},${n1(g.Y(p))}`).join(' ');
    out.push(`<polyline class="lh-path ${dir[start]}" points="${pts}" fill="none" vector-effect="non-scaling-stroke"/>`);
    start = i;
  }
  return out.join('');
}

function bars(minutes, dir, g) {
  const amount = Array.isArray(minutes.amount) ? minutes.amount.map(Number) : [];
  const max = Math.max(0, ...amount.filter(Number.isFinite));
  const w = n1(PLOT / LAST * 0.7);
  return dir.map((d, i) => {
    const h = max > 0 && Number.isFinite(amount[i]) ? amount[i] / max * BARS : 0;
    return `<rect class="lh-bar ${d}" x="${n1(g.X(i) - w / 2)}" y="${n1(BOTTOM - h)}" width="${w}" height="${n1(h)}"/>`;
  }).join('');
}

function extreme(price, g, which) {
  let at = 0;
  for (let i = 1; i < price.length; i++) if (which === 'H' ? price[i] > price[at] : price[i] < price[at]) at = i;
  const x = n1(g.X(at)), y = n1(g.Y(price[at]));
  const anchor = at > LAST / 2 ? 'end' : 'start';
  const ty = which === 'H' ? n1(Math.max(TOP + 8, y - 6)) : n1(Math.min(BOTTOM - 2, y + 14));
  return `<circle class="lh-mark-dot" cx="${x}" cy="${y}" r="2.5"/>` +
    `<text class="lh-mark" x="${x}" y="${ty}" text-anchor="${anchor}">${which} ${fix2(price[at])} · ${minuteLabel(at)}</text>`;
}

const GRID = [[0], [60], [120, 121], [181], [241]];

/** The intraday chart: viewBox 0 0 760 236, the cursor's line and dot named by `id` (cur-<id>, dot-<id>). */
export function intradaySvg(minutes, { focus = null, minute = null, id = '' } = {}) {
  const price = prices(minutes);
  const prec = Number(minutes?.prec);
  const g = chartGeometry(minutes);
  const last = price.length - 1;
  const at = Math.min(last, Math.max(0, Number.isInteger(minute) ? minute : last));
  const dir = directions(price, prec);
  const from = minuteIndex(focus?.from), to = minuteIndex(focus?.to);
  const band = from !== null && to !== null && to > from
    ? `<rect class="lh-band" x="${n1(g.X(from))}" y="${TOP}" width="${n1(g.X(to) - g.X(from))}" height="${BOTTOM - TOP}"/>` : '';
  const grid = GRID.map(ix => {
    const x = n1(g.X(ix[0]));
    const anchor = ix[0] === 0 ? 'start' : ix[0] === LAST ? 'end' : 'middle';
    return `<line class="lh-tick" x1="${x}" y1="${TOP}" x2="${x}" y2="${BOTTOM}"/>` +
      `<text class="lh-grid" x="${x}" y="${H - 1}" text-anchor="${anchor}">${ix.map(minuteLabel).join('/')}</text>`;
  }).join('');
  const cx = n1(g.X(at)), cy = n1(g.Y(price[at]));
  return `<svg class="lh-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="The day minute by minute">` +
    band + grid +
    `<line class="lh-mid" x1="${LEFT}" y1="${MID}" x2="${LEFT + PLOT}" y2="${MID}" stroke-dasharray="4 4"/>` +
    `<text class="lh-axis" x="${LEFT - 4}" y="${MID + 4}" text-anchor="end">${fix2(prec)}</text>` +
    bars(minutes, dir, g) + paths(price, dir, g) + extreme(price, g, 'H') + extreme(price, g, 'L') +
    `<line id="cur-${esc(id)}" class="lh-cur" x1="${cx}" y1="${TOP}" x2="${cx}" y2="${BOTTOM}"/>` +
    `<circle id="dot-${esc(id)}" class="lh-dot" cx="${cx}" cy="${cy}" r="3.5"/>` +
    `</svg>`;
}

/** A row's sparkline: viewBox 0 0 240 28, stretched to its box with the stroke kept. */
export function sparklineSvg(minutes) {
  const price = prices(minutes);
  const prec = Number(minutes?.prec);
  const { span } = chartGeometry(minutes);
  const pts = price.map((p, i) => `${n1(i / LAST * 240)},${n1(14 - (p - prec) / span * 12)}`).join(' ');
  const tone = price.length && price[price.length - 1] < prec ? 'down' : 'up';
  return `<svg class="lh-spark" viewBox="0 0 240 28" preserveAspectRatio="none" aria-hidden="true">` +
    `<line class="lh-spark-mid" x1="0" y1="14" x2="240" y2="14" vector-effect="non-scaling-stroke"/>` +
    `<polyline class="lh-spark-line ${tone}" points="${pts}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Where the cursor stands at `minute` on `symbol`'s line, and the readout's words; null when the view has no such line. */
export function cursorPatch(view, symbol, minute) {
  const row = (Array.isArray(view?.indices?.rows) ? view.indices.rows : []).find(r => r?.symbol === symbol);
  const price = prices(row?.minutes);
  if (!row || price.length === 0) return null;
  const at = Math.min(price.length - 1, Math.max(0, Math.round(Number(minute)) || 0));
  const prec = Number(row.minutes.prec);
  const g = chartGeometry(row.minutes);
  const amount = row.minutes.amount?.[at];
  const pct = prec > 0 ? signedPct((price[at] - prec) / prec * 100) : '—';
  return {
    x: n1(g.X(at)), y: n1(g.Y(price[at])),
    readout: `${row.name ?? symbol} · ${minuteLabel(at)} · ${fix2(price[at])} · ${pct} · ${yuan(amount)} this minute`,
  };
}

