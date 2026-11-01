// Plan 2 of the Lunhui run view, task 6: the indices block, drawn minute by minute — the chart's geometry, the intraday SVG,
// the sparklines, the block itself, and the minute cursor the slider and the pointer move without a store change; on the
// synthetic sealed 10-27 run's view (VIEW_1027), the SSE line sh000001 first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, intradaySvg, sparklineSvg, cursorPatch, minuteLabel } from '../../client/js/render/lunhui/intraday.js';
import { indicesHtml } from '../../client/js/render/lunhui/indices.js';
import { composedHtml } from '../../client/js/render/lunhui/composed.js';
import { minuteAt, applyCursor, reapplyCursors } from '../../client/js/host/lunhui.js';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { fakeWindow } from './helpers/fake-dom.js';
import { VIEW_1027 } from './helpers/lunhui-view.js';

const ID = 'c1-p7';
const SSE = VIEW_1027.indices.rows.find(r => r.symbol === 'sh000001');
const text = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const gridLabels = svg => [...svg.matchAll(/<text class="lh-grid"[^>]*>([^<]*)<\/text>/g)].map(x => x[1]);

test('chartGeometry: X spans 56–708 over the 242-point grid, the previous close sits on the midline', () => {
  const g = chartGeometry(SSE.minutes);
  assert.equal(g.X(0), 56);
  assert.equal(g.X(241), 708);
  assert.equal(g.Y(SSE.minutes.prec), 118);
  const far = Math.max(...SSE.minutes.price.map(p => Math.abs(p - SSE.minutes.prec)));
  assert.ok(Math.abs(g.span - far * 1.08) < 1e-9, 'span is the farthest move from the close, with 8% air');
  assert.ok(Math.abs(g.Y(SSE.minutes.prec + far) - (118 - 108 / 1.08)) < 1e-9);
  // a flat line still has a span: nothing divides by zero
  const flat = chartGeometry({ prec: 10, price: [10, 10, 10] });
  assert.ok(flat.span > 0 && Number.isFinite(flat.Y(10)));
});

// plan 3, task 4: the stock drawer's limits widen the span; without them every index chart is as it was
test('chartGeometry without limits is unchanged', () => {
  const g = chartGeometry(SSE.minutes);
  const same = chartGeometry(SSE.minutes, null);
  assert.equal(same.span, g.span);
  assert.equal(same.Y(3700), g.Y(3700));
  assert.equal(intradaySvg(SSE.minutes, { minute: 241, id: ID }), intradaySvg(SSE.minutes, { minute: 241, id: ID, limits: null, seals: null }));
  assert.doesNotMatch(intradaySvg(SSE.minutes, { minute: 241, id: ID }), /lh-limit|lh-seal/);
  // without limits the domain is symmetric about the previous close, prec on the midline; a stock's limits (the run view
  // polish, 2026-10-31) switch to the stock's own asymmetric day, the index call never passes them
  assert.ok(Math.abs(g.hi - SSE.minutes.prec - g.span) < 1e-9 && Math.abs(SSE.minutes.prec - g.lo - g.span) < 1e-9);
  assert.equal(g.mid, 118);
});

test('intradaySvg: the band from 14:00 to 15:00, the midline, the path, the bars, high and low, the cursor, the grid', () => {
  const svg = intradaySvg(SSE.minutes, { focus: { from: '14:00', to: '15:00' }, minute: 241, id: ID });
  assert.match(svg, /^<svg[^>]*viewBox="0 0 760 236"/);
  assert.match(svg, /<rect class="lh-band" x="545\.7" [^>]*width="162\.3"/);
  assert.match(svg, /<line class="lh-mid" x1="56" y1="118" x2="708" y2="118" stroke-dasharray="4 4"/);
  assert.match(svg, /<polyline class="lh-path (up|down)"/);
  assert.match(svg, /<polyline class="lh-path up"/, 'the morning climbs');
  assert.match(svg, /<polyline class="lh-path down"/, 'the afternoon falls');
  assert.equal((svg.match(/<rect class="lh-bar (up|down)"/g) ?? []).length, 242, 'one amount bar a minute');
  assert.match(text(svg), /H 3712\.31 · 10:00/);
  assert.match(text(svg), /L 3648\.34 · 15:00/);
  assert.match(svg, /<line id="cur-c1-p7" class="lh-cur" x1="708" y1="10" x2="708" y2="226"/);
  assert.match(svg, /<circle id="dot-c1-p7" class="lh-dot" cx="708" cy="[\d.]+" r="3.5"/);
  assert.deepEqual(gridLabels(svg), ['09:30', '10:30', '11:30/13:00', '14:00', '15:00']);
  assert.doesNotMatch(intradaySvg(SSE.minutes, { minute: 241, id: ID }), /lh-band/, 'no focus, no band');
});

// Review Focus 5: the labels come from the grid, never from Date in the browser's zone
test('under TZ=America/New_York the grid still reads 09:30–15:00 China time', () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(new Date('2026-10-27T01:30:00Z').getHours(), 21, 'the process really is in New York');
    assert.deepEqual(gridLabels(intradaySvg(SSE.minutes, { minute: 0, id: ID })), ['09:30', '10:30', '11:30/13:00', '14:00', '15:00']);
    assert.equal(minuteLabel(0), '09:30');
    assert.equal(minuteLabel(120), '11:30');
    assert.equal(minuteLabel(121), '13:00');
    assert.equal(minuteLabel(241), '15:00');
    assert.match(cursorPatch(VIEW_1027, 'sh000001', 0).readout, / · 09:30 · /);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test('sparklineSvg: a 240×28 line that keeps its stroke when stretched', () => {
  const svg = sparklineSvg(SSE.minutes);
  assert.match(svg, /viewBox="0 0 240 28"/);
  assert.match(svg, /preserveAspectRatio="none"/);
  assert.match(svg, /vector-effect="non-scaling-stroke"/);
  assert.match(svg, /<polyline class="lh-spark-line down"/, 'the day closed under its previous close');
});

test('indicesHtml: four rows in index order, the selected row charted, the slider at the last minute, the readout for 15:00', () => {
  const html = indicesHtml(VIEW_1027, { kind: 'indices', title: '指数<全线>下跌', focus: { from: '14:00', to: '15:00' } }, {}, ID);
  const rows = [...html.matchAll(/<button[^>]*class="lh-ix[^"]*"[^>]*data-value="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(rows, ['sh000001', 'sz399001', 'sz399006', 'sh000300']);
  for (const b of html.match(/<button[^>]*class="lh-ix[^"]*"[^>]*>/g)) {
    assert.match(b, /data-action="lunhuiUi"/);
    assert.match(b, /data-id="c1-p7"/);
    assert.match(b, /data-field="index"/);
  }
  assert.equal((html.match(/<svg class="lh-spark"/g) ?? []).length, 4, 'a sparkline in every row');
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*data-value="sh000001"|data-value="sh000001"[^>]*aria-pressed="true"/);
  assert.match(html, /指数&lt;全线&gt;下跌/, 'the title escaped');
  assert.match(html, /<rect class="lh-band" x="545\.7"/);
  const range = html.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? '';
  assert.match(range, /id="minute-c1-p7"/);
  assert.match(range, /data-action="lunhuiMinute"/);
  assert.match(range, /min="0"/);
  assert.match(range, /max="241"/);
  assert.match(range, /value="241"/);
  assert.match(range, /data-symbol="sh000001"/);
  assert.match(html, /<svg class="lh-chart"[^>]*data-action="lunhuiHover"/);
  const read = html.match(/<div class="lh-readout" id="read-c1-p7" role="status"[^>]*>([^<]*)<\/div>/)?.[1];
  assert.equal(read, cursorPatch(VIEW_1027, 'sh000001', 241).readout);
  assert.match(text(html), /上证指数3648\.30−1\.33%/);
  // another pick charts that index; a symbol the view does not hold falls back to the first
  assert.match(indicesHtml(VIEW_1027, { kind: 'indices' }, { index: 'sz399006' }, ID), /data-symbol="sz399006"/);
  assert.match(indicesHtml(VIEW_1027, { kind: 'indices' }, { index: 'nope' }, ID), /data-symbol="sh000001"/);
});

test('indicesHtml: an index with no minute line says so; a run without indices says that', () => {
  const rows = VIEW_1027.indices.rows.map((r, i) => (i === 1 ? { ...r, minutes: null, minutesMissing: 'NOT_FROZEN' } : r));
  const html = indicesHtml({ ...VIEW_1027, indices: { rows, unavailable: null } }, { kind: 'indices' }, { index: 'sz399001' }, ID);
  assert.match(text(html), /No minute line frozen for 深证成指/);
  assert.doesNotMatch(html, /type="range"/);
  assert.match(text(indicesHtml({ ...VIEW_1027, indices: { rows: [], unavailable: 'index not frozen' } }, { kind: 'indices' }, {}, ID)), /Indices were not frozen for this run\./);
});

test('the composed answer draws the indices block by its kind', () => {
  const m = { id: 'p7', kind: 'composed', text: '弱势日', data: { strategy: 'cn-market', run: VIEW_1027.run, blocks: [{ kind: 'indices' }], modules: [] } };
  const html = composedHtml(m, { status: 'loaded', view: VIEW_1027 }, {}, { id: 'c1' });
  assert.match(html, /id="minute-c1-p7"/);
});

test('cursorPatch: x and y on the chart, and the readout in the digest grammar', () => {
  const p = cursorPatch(VIEW_1027, 'sh000001', 241);
  assert.match(p.readout, /^上证指数 · 15:00 · 3648\.\d\d · −\d\.\d\d% · ¥\d+\.\d\d亿 this minute$/);
  assert.equal(p.readout, '上证指数 · 15:00 · 3648.34 · −1.33% · ¥4.74亿 this minute');
  const g = chartGeometry(SSE.minutes);
  assert.equal(p.x, 708);
  assert.equal(p.y, Number(g.Y(3648.34).toFixed(1)));
  const up = cursorPatch(VIEW_1027, 'sh000001', 30);
  assert.match(up.readout, /^上证指数 · 10:00 · 3712\.31 · \+0\.40% · ¥/);
  assert.match(cursorPatch(VIEW_1027, 'sh000001', 0).readout, / · 0\.00% · /, 'the close itself is 0.00%');
  assert.equal(cursorPatch(VIEW_1027, 'sh000001', 999).x, 708, 'a minute past the line is its last');
  assert.equal(cursorPatch(VIEW_1027, 'nope', 3), null);
  // the digest's amount grammar, the same as breadth's turnover: 万亿 from 1e12, 亿 from 1e8, then the face's 万 from 1e4, else whole yuan
  const withAmount = amount => ({ ...VIEW_1027, indices: { ...VIEW_1027.indices, rows: [{ ...SSE, minutes: { ...SSE.minutes, amount: SSE.minutes.amount.map((x, i) => (i === 5 ? amount : x)) } }] } });
  assert.match(cursorPatch(withAmount(98_765_432), 'sh000001', 5).readout, / · ¥9876\.54万 this minute$/);
  assert.match(cursorPatch(withAmount(1_234_000_000_000), 'sh000001', 5).readout, / · ¥1\.23万亿 this minute$/);
  assert.match(cursorPatch(withAmount(null), 'sh000001', 5).readout, / · — this minute$/);
});

test('minuteAt: the pointer over the chart to its grid minute, clamped', () => {
  const rect = { left: 100, width: 760 };
  assert.equal(minuteAt(156, rect, 241), 0);
  assert.equal(minuteAt(808, rect, 241), 241);
  assert.equal(minuteAt(0, rect, 241), 0);
  assert.equal(minuteAt(5000, rect, 241), 241);
  assert.equal(minuteAt(808, rect, 100), 100, 'never past the last frozen minute');
  assert.equal(minuteAt(100 + 380, { left: 100, width: 380 }, 241), 241, 'a chart drawn smaller scales to the viewBox');
});

test('applyCursor sets the line, the dot and the readout, and dispatches nothing', () => {
  const f = fakeWindow();
  const cur = f.withId(`cur-${ID}`); const dot = f.withId(`dot-${ID}`); const read = f.withId(`read-${ID}`);
  const store = createStore({ initial: emptyState(), reducers });
  let dispatched = 0;
  const dispatch = store.dispatch; store.dispatch = (...a) => { dispatched++; return dispatch(...a); };
  const before = store.get();
  const p = cursorPatch(VIEW_1027, 'sh000001', 120);
  applyCursor(f.doc, ID, p);
  assert.equal(cur.attributes.x1, String(p.x)); assert.equal(cur.attributes.x2, String(p.x));
  assert.equal(dot.attributes.cx, String(p.x)); assert.equal(dot.attributes.cy, String(p.y));
  assert.equal(read.textContent, p.readout);
  assert.equal(dispatched, 0); assert.equal(store.get(), before);
  applyCursor(fakeWindow().doc, ID, p);   // nothing drawn under that id: nothing to set, nothing thrown
});

// Review Focus 4, at the unit: a redraw drew the cursor at the last minute; the slider the render restored stands at 120
test('reapplyCursors puts each moved slider\'s cursor back; a slider at its max is left as drawn', () => {
  const f = fakeWindow();
  const state = { ...emptyState(), lunhui: { views: { k: { status: 'loaded', view: VIEW_1027 } }, ui: {} } };
  const moved = f.withSelector('input[data-action="lunhuiMinute"]', { tagName: 'INPUT', type: 'range', value: '120', max: '241', dataset: { action: 'lunhuiMinute', id: ID, strategy: VIEW_1027.strategy, run: VIEW_1027.run, symbol: 'sh000001' } });
  f.withSelector('input[data-action="lunhuiMinute"]', { tagName: 'INPUT', type: 'range', value: '241', max: '241', dataset: { action: 'lunhuiMinute', id: 'c1-p8', strategy: VIEW_1027.strategy, run: VIEW_1027.run, symbol: 'sh000001' } });
  const cur = f.withId(`cur-${ID}`, { attributes: { x1: '708' } });
  const other = f.withId('cur-c1-p8', { attributes: { x1: '708' } });
  reapplyCursors(f.root, f.doc, state);
  assert.equal(Number(cur.attributes.x1), Number(chartGeometry(SSE.minutes).X(120).toFixed(1)));
  assert.equal(other.attributes.x1, '708');
  assert.ok(moved);
  // a view not loaded (or gone) leaves the drawn cursor alone
  reapplyCursors(f.root, f.doc, emptyState());
});
