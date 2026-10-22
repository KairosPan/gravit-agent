// The charts (spec 2026-10-19 §7 Stage 2, spec 2026-10-22 §6.2): a Market page's daily closes from /data/bars, and the
// Account's net-worth curve from its history read — each an area and a line, the demo chart's geometry, with a label that
// says what it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSvg, curveSvg } from '../../client/js/render/chart.js';
import { fmtClock, fmtDate } from '../../client/js/time.js';

const rows = closes => closes.map((close, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, open: close, high: close, low: close, close, volume: 1 }));
const lineOf = svg => svg.match(/class="mk-chart-line" d="([^"]+)"/)[1];
// the Account's history points ({ at, usd }, oldest first), a day apart from Oct 15 09:30 on the operator's clock
const at = i => new Date(2026, 9, 15 + i, 9, 30).toISOString();
const points = values => values.map((usd, i) => ({ at: at(i), usd }));
const word = i => `${fmtDate(Date.parse(at(i)))} ${fmtClock(Date.parse(at(i)))}`;

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

test('curveSvg: the net worth in the same box, labelled by its points\' times; fewer than two points draw nothing', () => {
  assert.equal(curveSvg([], { currency: 'USD' }), '');
  assert.equal(curveSvg(points([5]), { currency: 'USD' }), '');
  assert.equal(curveSvg(points([null, 5, 'n/a']), { currency: 'USD' }), '', 'a point without a number is left out');
  assert.equal(curveSvg(undefined, {}), '');
  const svg = curveSvg(points([10, 12, 8, 11]), { currency: 'USD' });
  assert.match(svg, /^<svg class="mk-chart" viewBox="0 0 400 140" preserveAspectRatio="none" role="img"/);
  assert.equal(lineOf(svg), lineOf(chartSvg(rows([10, 12, 8, 11]), { currency: 'USD' })), "the closes chart's geometry");
  assert.match(lineOf(svg), /^M0\.0,[\d.]+L133\.3,6\.0L266\.7,134\.0L400\.0,[\d.]+$/);
  assert.match(svg, /class="mk-chart-area" d="M0\.0,[^"]*L400,140L0,140Z"/);
  assert.ok(svg.includes(`aria-label="Net worth from ${word(0)} to ${word(3)}: from $10.00 to $11.00, low $8.00, high $12.00"`));
  assert.ok(svg.endsWith(`<div class="mk-axis"><span>${word(0)}</span><span>Low $8.00 · High $12.00</span><span>${word(3)}</span></div>`));
  const gaps = curveSvg(points([null, 28929.32, 'n/a', 28591.76, null]), { currency: 'USD' });
  assert.equal(lineOf(gaps).split(/[ML]/).filter(Boolean).length, 2);
  assert.ok(gaps.includes(`Net worth from ${word(1)} to ${word(3)}: from $28,929.32 to $28,591.76`));
  assert.doesNotMatch(curveSvg(points([25400, 25400]), { currency: 'USD' }), /NaN/, 'a flat book still draws');
  // the curve says whose figure it draws, Net worth unless told
  assert.ok(curveSvg(points([25000, 25400]), { currency: 'USD', label: 'Paper' }).includes(`aria-label="Paper from ${word(0)} to ${word(1)}: from $25,000.00 to $25,400.00`));
  // a point whose time does not parse is left out, as one without a number is
  const timeless = curveSvg([{ at: 'not a time', usd: 99 }, ...points([10, 20]), { usd: 5 }], { currency: 'USD' });
  assert.ok(timeless.includes(`aria-label="Net worth from ${word(0)} to ${word(1)}: from $10.00 to $20.00, low $10.00, high $20.00"`), timeless);
});
