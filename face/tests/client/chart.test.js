// The charts (spec 2026-10-19 §7 Stage 2, spec 2026-10-22 §6.1–§6.2): a market's closes from the Account's candles read, and
// the Account's net-worth curve from its history read — each an area and a line, the demo chart's geometry, with a label that
// says what it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as chart from '../../client/js/render/chart.js';
const { sessionsSvg } = chart;
import { fmtClock, fmtDate } from '../../client/js/time.js';

const { candlesSvg, curveSvg } = chart;
const lineOf = svg => svg.match(/class="mk-chart-line" d="([^"]+)"/)[1];
// the Account's history points ({ at, usd }, oldest first), a day apart from Oct 15 09:30 on the operator's clock
const at = i => new Date(2026, 9, 15 + i, 9, 30).toISOString();
const points = values => values.map((usd, i) => ({ at: at(i), usd }));
const word = i => `${fmtDate(Date.parse(at(i)))} ${fmtClock(Date.parse(at(i)))}`;
// the closes chart's geometry for 10, 12, 8, 11: the high touches the top margin, the low the bottom, edge to edge
const GEOMETRY = /^M0\.0,[\d.]+L133\.3,6\.0L266\.7,134\.0L400\.0,[\d.]+$/;

test('the charts are the Account\'s two: the daily_bars chart left with alpaca-kit', () => {
  assert.deepEqual(Object.keys(chart).sort(), ['candlesSvg', 'curveSvg', 'sessionsSvg']);
});

test("candlesSvg: a market's closes in the same box, the axis at its first and last bars' times; cents for an event; fewer than two closes draw nothing", () => {
  // the Account's bars ({ t, o, h, l, c }, t a bar's start in ms), a minute apart from Oct 21 09:30 on the operator's clock
  const t0 = new Date(2026, 9, 21, 9, 30).getTime();
  const bars = closes => closes.map((c, i) => ({ t: t0 + i * 60_000, o: c, h: c, l: c, c }));
  const barWord = i => `${fmtDate(t0 + i * 60_000)} ${fmtClock(t0 + i * 60_000)}`;
  const svg = candlesSvg(bars([10, 12, 8, 11]), { unit: 'usd', range: '1D' });
  assert.match(svg, /^<svg class="mk-chart" viewBox="0 0 400 140" preserveAspectRatio="none" role="img"/);
  assert.match(lineOf(svg), GEOMETRY, "the closes chart's geometry");
  assert.ok(svg.includes('aria-label="Closes over 1D: from $10.00 to $11.00, low $8.00, high $12.00"'), svg);
  assert.ok(svg.endsWith(`<div class="mk-axis"><span>${barWord(0)}</span><span>Low $8.00 · High $12.00</span><span>${barWord(3)}</span></div>`));
  // an event contract's closes are dollars a contract: in cents
  assert.ok(candlesSvg(bars([0.62, 0.645, 0.6]), { unit: 'cents', range: 'MAX' }).includes('aria-label="Closes over MAX: from 62¢ to 60¢, low 60¢, high 64.5¢"'));
  // a bar without a close or a time is left out; fewer than two closes draw nothing
  assert.equal(candlesSvg([], { unit: 'usd', range: '1D' }), '');
  assert.equal(candlesSvg(undefined), '');
  assert.equal(candlesSvg(bars([5]), { unit: 'usd', range: '1D' }), '');
  const gaps = candlesSvg([{ t: t0, c: null }, ...bars([10, 20]), { c: 30 }, { t: 'n/a', c: 40 }], { unit: 'usd', range: '5D' });
  assert.ok(gaps.includes('aria-label="Closes over 5D: from $10.00 to $20.00, low $10.00, high $20.00"'), gaps);
  assert.equal(lineOf(gaps).split(/[ML]/).filter(Boolean).length, 2);
  assert.doesNotMatch(candlesSvg(bars([5, 5]), { unit: 'usd', range: '1D' }), /NaN/, 'a flat history still draws');
});

test('curveSvg: the net worth in the same box, labelled by its points\' times; fewer than two points draw nothing', () => {
  assert.equal(curveSvg([], { currency: 'USD' }), '');
  assert.equal(curveSvg(points([5]), { currency: 'USD' }), '');
  assert.equal(curveSvg(points([null, 5, 'n/a']), { currency: 'USD' }), '', 'a point without a number is left out');
  assert.equal(curveSvg(undefined, {}), '');
  const svg = curveSvg(points([10, 12, 8, 11]), { currency: 'USD' });
  assert.match(svg, /^<svg class="mk-chart" viewBox="0 0 400 140" preserveAspectRatio="none" role="img"/);
  assert.match(lineOf(svg), GEOMETRY, "the closes chart's geometry");
  assert.match(svg, /class="mk-chart-area" d="M0\.0,[^"]*L400,140L0,140Z"/);
  assert.match(curveSvg(points([1688, 1700]), { currency: 'CNY' }), /from ¥1,688\.00 to ¥1,700\.00/, 'the figure in its own currency');
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

test('candlesSvg in yuan on Beijing dates; the Account call unchanged', () => {
  const bars = [{ t: Date.parse('2026-10-29T07:00:00Z'), c: 1354 }, { t: Date.parse('2026-10-30T07:00:00Z'), c: 1392.05 }];
  const svg = candlesSvg(bars, { unit: 'cny', zone: 'Asia/Shanghai', range: '1M' });
  assert.match(svg, /<span>2026-10-29<\/span>/);
  assert.match(svg, /<span>2026-10-30<\/span>/);
  assert.match(svg, /Low ¥1,354\.00 · High ¥1,392\.05/);
});

test('sessionsSvg: five sessions on one grid, the previous close dashed, a separator between sessions', () => {
  const session = (date, n = 242) => ({ date, prec: 100, price: Array.from({ length: n }, (_, i) => 100 + (i % 5)), amount: [] });
  const five = sessionsSvg(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map(d => session(d)));
  assert.equal((five.match(/class="mk-chart-sep"/g) ?? []).length, 4);
  assert.equal((five.match(/class="mk-chart-prev"/g) ?? []).length, 1);
  assert.equal((five.match(/class="mk-chart-line"/g) ?? []).length, 1);
  assert.match(five, /<span>10-26<\/span>/);
  assert.match(five, /<span>10-30<\/span>/);
  assert.match(five, /Low ¥100\.00 · High ¥104\.00/);
  assert.equal((sessionsSvg([session('2026-10-30', 2)]).match(/class="mk-chart-sep"/g) ?? []).length, 0);
  assert.equal(sessionsSvg([]), '');
  assert.equal(sessionsSvg([session('2026-10-30', 1)]), '');
});

test('sessionsSvg writes every session date on its axis (minor #5)', () => {
  const session = date => ({ date, prec: 100, price: [100, 101], amount: [] });
  const svg = sessionsSvg(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map(session));
  for (const d of ['10-26', '10-27', '10-28', '10-29', '10-30']) assert.match(svg, new RegExp(`<span>${d}</span>`), d);
});
