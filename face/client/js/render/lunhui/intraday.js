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

const fin = v => v != null && v !== '' && Number.isFinite(Number(v));

/**
 * The chart's geometry: X over the grid's 242 points. An index's Y (no `limits`) is symmetric about the previous close, the
 * day's farthest move plus 8%, prec on the midline. A stock's Y (with `limits`, { up, down }, the view's own) is its own day,
 * asymmetric: the minute prices and prec, the limit-up when `includeUp` (pools zt and zb), the limit-down when the line closes
 * at it, 6% air each side and a span of at least prec · 0.002; `lo` and `hi` are its domain, `mid` prec's y.
 */
export function chartGeometry(minutes, limits = null, { includeUp = false } = {}) {
  const prec = Number(minutes?.prec);
  const X = i => LEFT + i / LAST * PLOT;
  if (!limits) {
    const far = Math.max(0, ...prices(minutes).filter(Number.isFinite).map(p => Math.abs(p - prec)));
    // a flat day still needs a span: a thousandth of the close, or 1
    const span = far > 0 ? far * 1.08 : (Math.abs(prec) > 0 ? Math.abs(prec) * 0.001 : 1);
    return { X, Y: p => MID - (p - prec) / span * HALF, span, lo: prec - span, hi: prec + span, mid: MID };
  }
  const price = prices(minutes).filter(Number.isFinite);
  const pts = [...price, ...(Number.isFinite(prec) ? [prec] : [])];
  if (includeUp && fin(limits.up)) pts.push(Number(limits.up));
  if (fin(limits.down) && price.length && price[price.length - 1] <= Number(limits.down) + 0.005) pts.push(Number(limits.down));
  let lo = pts.length ? Math.min(...pts) : 0, hi = pts.length ? Math.max(...pts) : 1;
  const least = Math.abs(prec) > 0 ? Math.abs(prec) * 0.002 : 1;
  if (hi - lo < least) { const c = (hi + lo) / 2; lo = c - least / 2; hi = c + least / 2; }
  const air = (hi - lo) * 0.06;
  lo -= air; hi += air;
  const Y = p => BOTTOM - (p - lo) / (hi - lo) * (BOTTOM - TOP);
  return { X, Y, span: (hi - lo) / 2, lo, hi, mid: Y(prec) };
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

// each minute's bar, scaled to the busiest minute by amount (an index) or by volume (a stock: bars: 'volume')
function bars(minutes, dir, g, field = 'amount') {
  const amount = Array.isArray(minutes[field]) ? minutes[field].map(Number) : [];
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

// a seal's grid minute: one before the open (the call auction, 09:25) sits on the open's point
export const sealIndex = t => minuteIndex(t) ?? (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) && t < '09:30' ? 0 : null);

// a stock's limit lines, each only inside the drawn domain, under the price line
function limitLines(g, limits) {
  if (!limits) return '';
  const line = (dir, p) => `<line class="lh-limit ${dir}" x1="${LEFT}" y1="${n1(g.Y(p))}" x2="${LEFT + PLOT}" y2="${n1(g.Y(p))}"/>`;
  const inside = v => fin(v) && Number(v) >= g.lo && Number(v) <= g.hi;
  return (inside(limits.up) ? line('up', Number(limits.up)) : '') + (inside(limits.down) ? line('down', Number(limits.down)) : '');
}

// a stock's first and last seal on the limit-up, drawn after the price line so they sit on top of it
function sealMarks(g, limits, seals) {
  if (!fin(limits?.up) || Number(limits.up) < g.lo || Number(limits.up) > g.hi) return '';
  const up = Number(limits.up);
  const at = [...new Set([seals?.first, seals?.last].map(sealIndex).filter(i => i !== null))];
  return at.map(i => `<circle class="lh-seal" cx="${n1(g.X(i))}" cy="${n1(g.Y(up))}" r="3"/>`).join('');
}

/**
 * The intraday chart: viewBox 0 0 760 236, the cursor's line and dot named by `id` (cur-<id>, dot-<id>). A stock's chart
 * adds `limits` ({ up, down }), `includeUp` (the limit-up in its domain: pools zt and zb), `seals` ({ first, last }, "HH:MM")
 * and `bars: 'volume'`; each is off by default. A stock's chart scales to its own day and draws no H/L marks.
 */
export function intradaySvg(minutes, { focus = null, minute = null, id = '', limits = null, includeUp = false, seals = null, bars: barsBy = 'amount' } = {}) {
  const price = prices(minutes);
  const prec = Number(minutes?.prec);
  const g = chartGeometry(minutes, limits, { includeUp });
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
    `<line class="lh-mid" x1="${LEFT}" y1="${n1(g.mid)}" x2="${LEFT + PLOT}" y2="${n1(g.mid)}" stroke-dasharray="4 4"/>` +
    `<text class="lh-axis" x="${LEFT - 4}" y="${n1(g.mid + 4)}" text-anchor="end">${fix2(prec)}</text>` +
    bars(minutes, dir, g, barsBy === 'volume' ? 'volume' : 'amount') + limitLines(g, limits) + paths(price, dir, g) + sealMarks(g, limits, seals) +
    (limits ? '' : extreme(price, g, 'H') + extreme(price, g, 'L')) +
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

// at the limit-up within half a fen of it, and the limit-down mirrored
export const atLimitUp = (p, f) => fin(p) && fin(f?.limitUp) && Number(p) >= Number(f.limitUp) - 0.005;
export const atLimitDown = (p, f) => fin(p) && fin(f?.limitDown) && Number(p) <= Number(f.limitDown) + 0.005;
/** A stock's limits for its chart ({ up, down }, the view's own), or null without a limit-up. */
export const limitsOf = f => (fin(f?.limitUp) ? { up: Number(f.limitUp), down: fin(f.limitDown) ? Number(f.limitDown) : null } : null);
/** Whether a stock's chart takes the limit-up into its domain: the limit-up and broken pools (zt, zb). */
export const includesUp = f => f?.pool === 'zt' || f?.pool === 'zb';

// a stock's cursor (plan 3, task 4): name · time · price · change, and where it stands against the limits
function stockPatch(stock, symbol, minute) {
  const price = prices(stock.minutes);
  if (price.length === 0) return null;
  const at = Math.min(price.length - 1, Math.max(0, Math.round(Number(minute)) || 0));
  const prec = Number(stock.minutes.prec);
  const g = chartGeometry(stock.minutes, limitsOf(stock), { includeUp: includesUp(stock) });
  const p = price[at];
  const pct = prec > 0 && fin(p) ? signedPct((p - prec) / prec * 100) : '—';
  const where = atLimitUp(p, stock) ? ' · at the limit-up' : atLimitDown(p, stock) ? ' · at the limit-down' : '';
  return {
    x: n1(g.X(at)), y: n1(g.Y(p)),
    readout: `${stock.name ?? stock.code ?? symbol} · ${minuteLabel(at)} · ${fin(p) ? fix2(p) : '—'} · ${pct}${where}`,
  };
}

/** Where the cursor stands at `minute` on `symbol`'s line, and the readout's words; null when the view has no such line. */
export function cursorPatch(view, symbol, minute) {
  const row = (Array.isArray(view?.indices?.rows) ? view.indices.rows : []).find(r => r?.symbol === symbol);
  if (!row) {
    const stocks = view?.stocks && typeof view.stocks === 'object' ? Object.values(view.stocks) : [];
    // a stock whose symbol is null (a code exchangeOf does not know) is found by its code
    const stock = symbol == null || symbol === '' ? null : stocks.find(s => s?.symbol === symbol || s?.code === symbol);
    return stock ? stockPatch(stock, symbol, minute) : null;
  }
  const price = prices(row?.minutes);
  if (price.length === 0) return null;
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

