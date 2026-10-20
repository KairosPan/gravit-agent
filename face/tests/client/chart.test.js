// The Market page's chart (spec 2026-10-19 §7 Stage 2): daily closes from /data/bars as an area and a line, the demo
// chart's geometry, with a label that says what it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSvg } from '../../client/js/render/chart.js';

const rows = closes => closes.map((close, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, open: close, high: close, low: close, close, volume: 1 }));
const lineOf = svg => svg.match(/class="mk-chart-line" d="([^"]+)"/)[1];

test('fewer than two closes draw nothing', () => {
  assert.equal(chartSvg([], { currency: 'USD' }), '');
  assert.equal(chartSvg(rows([5]), { currency: 'USD' }), '');
  assert.equal(chartSvg(rows([null, 5, null]), { currency: 'USD' }), '');
  assert.equal(chartSvg(undefined, {}), '');
});

test('the path spans the box and the aria-label names the range', () => {
  const svg = chartSvg(rows([10, 12, 8, 11]), { currency: 'USD' });
  assert.match(svg, /^<svg class="mk-chart" viewBox="0 0 400 140" preserveAspectRatio="none" role="img"/);
  const line = lineOf(svg);
  assert.match(line, /^M0\.0,/, 'from the left edge');
  assert.match(line, /L400\.0,[\d.]+$/, 'to the right edge');
  assert.match(line, /L133\.3,6\.0/, 'the high touches the top margin');
  assert.match(line, /L266\.7,134\.0/, 'the low touches the bottom margin');
  assert.match(svg, /class="mk-chart-area" d="M0\.0,[^"]*L400,140L0,140Z"/);
  assert.match(svg, /aria-label="Daily closes from 2026-10-01 to 2026-10-04: from \$10\.00 to \$11\.00, low \$8\.00, high \$12\.00"/);
  assert.match(svg, /<div class="mk-axis"><span>2026-10-01<\/span><span>Low \$8\.00 · High \$12\.00<\/span><span>2026-10-04<\/span><\/div>$/);
  assert.match(chartSvg(rows([1688, 1700]), { currency: 'CNY' }), /from ¥1,688\.00 to ¥1,700\.00/);
});

test('null closes are skipped', () => {
  const svg = chartSvg(rows([null, 10, null, 20, null]), { currency: 'USD' });
  assert.equal(lineOf(svg).split(/[ML]/).filter(Boolean).length, 2);
  assert.match(svg, /from 2026-10-02 to 2026-10-04/);
  const flat = chartSvg(rows([5, 5]), { currency: 'USD' });
  assert.doesNotMatch(flat, /NaN/, 'a flat series still draws');
});
