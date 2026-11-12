// The charts (spec 2026-10-19 §7 Stage 2, spec 2026-10-22 §6.1–§6.2): a market's closes from the Account's candles read, and
// the Account's net-worth curve from its history read — each an area and a line, the demo chart's geometry, with a label that
// says what it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as chart from '../../client/js/render/chart.js';
const { sessionsSvg, eventCandlesSvg, eventRelSvg } = chart;
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
  assert.deepEqual(Object.keys(chart).sort(), ['candlesSvg', 'curveSvg', 'eventCandlesSvg', 'eventRelSvg', 'sessionsSvg']);
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

test("a chart's times are a day and a clock in the table's order", async () => {
  const { withTable } = await import('../../client/js/i18n/words.js');
  const svg = withTable({ 'time.dayClock': '{clock} ({day})' }, () => curveSvg(points([1, 2]), { currency: 'USD' }));
  assert.ok(svg.includes(`<span>${fmtClock(Date.parse(at(0)))} (${fmtDate(Date.parse(at(0)))})</span>`), svg);
});

test('sessionsSvg says one session in the singular, more in the plural', () => {
  const session = (date, n = 242) => ({ date, prec: 100, price: Array.from({ length: n }, (_, i) => 100 + (i % 5)), amount: [] });
  assert.match(sessionsSvg([session('2026-10-30')]), /aria-label="The last session, 10-30 to 10-30: low ¥100\.00, high ¥104\.00"/);
  assert.match(sessionsSvg([session('2026-10-29'), session('2026-10-30')]), /aria-label="The last 2 sessions, 10-29 to 10-30: /);
});

// an event's window (analog event table Task 9): weekday daily bars from 2017-12-11 at 14:30 UTC (09:30 New York), rising by one
// a session but for bar 5, which falls
function windowBars(n) {
  const bars = [];
  for (let t = Date.parse('2017-12-11T14:30:00Z'); bars.length < n; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const i = bars.length;
    const [o, c] = i === 5 ? [110, 100] : [100 + i, 100.5 + i];
    bars.push({ t, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c });
  }
  return bars;
}
const allOf = (svg, re) => [...svg.matchAll(re)];

test('eventCandlesSvg: one body and one wick per bar, five price lines, about seven date ticks, day 0 at its bar, the marks and the flags', () => {
  const bars = windowBars(91);
  const svg = eventCandlesSvg(bars, {
    day0: 30,
    marks: [{ index: 30, label: 'Wynn <Resorts>', kind: 'day0' }, { index: 38, label: 'B 创始人/当天离任 · Wynn resigns', kind: 'other' }],
    flags: [{ index: 35, label: '5 天', text: '−14.6%', tone: 'down' }, { index: 90, label: '60 天', text: '+2.0%', tone: 'up' }],
    unit: 'usd',
  });
  assert.match(svg, /^<svg class="ew-chart" viewBox="0 0 640 260" role="img" aria-label="[^"]+">/);
  const bodies = allOf(svg, /<rect class="ew-body (up|down)" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g);
  const wicks = allOf(svg, /<line class="ew-wick (up|down)" x1="([\d.]+)"/g);
  assert.equal(bodies.length, 91);
  assert.equal(wicks.length, 91);
  assert.equal(bodies[5][1], 'down', 'a falling bar is down');
  assert.equal(wicks[5][1], 'down');
  assert.equal(bodies[4][1], 'up');
  // the day-0 band and line sit at bar 30's centre
  const day0 = svg.match(/<line class="ew-day0" x1="([\d.]+)"/)[1];
  assert.equal(day0, wicks[30][2]);
  assert.equal((Number(bodies[30][2]) + Number(bodies[30][3]) / 2).toFixed(1), day0);
  assert.match(svg, /<rect class="ew-band" /);
  // its label: the bar's date and the case's label, escaped
  assert.ok(svg.includes('>01-22 Wynn &lt;Resorts&gt;</text>'), svg.match(/ew-day0-label[^<]*<\/text>/)?.[0]);
  // another mark: a dashed line at its bar, labelled as given (its group and label)
  assert.equal(svg.match(/<line class="ew-mark" x1="([\d.]+)"/)[1], wicks[38][2]);
  assert.ok(svg.includes('>B 创始人/当天离任 · Wynn resigns</text>'));
  // five price lines with their prices on the right; about seven MM-DD ticks
  assert.equal(allOf(svg, /<line class="ew-grid"/g).length, 5);
  const prices = allOf(svg, /<text class="ew-price"[^>]*>([^<]+)<\/text>/g).map(m => m[1]);
  assert.equal(prices.length, 5);
  assert.ok(prices.every(p => /^\$\d+\.\d\d$/.test(p)), prices.join());
  const ticks = allOf(svg, /<text class="ew-tick"[^>]*>([^<]+)<\/text>/g).map(m => m[1]);
  assert.ok(ticks.length >= 6 && ticks.length <= 8, ticks.join());
  assert.ok(ticks.every(d => /^\d\d-\d\d$/.test(d)), ticks.join());
  assert.equal(ticks[0], '12-11');
  // the flags read as they were given, a chip each in its tone
  assert.ok(svg.includes('>5 天 −14.6%</text>'));
  assert.match(svg, /<g class="ew-flag down">/);
  assert.match(svg, /<g class="ew-flag up">[^]*?>60 天 \+2\.0%<\/text>/);
  assert.doesNotMatch(svg, /NaN|undefined/);
  // fewer than two bars draw nothing
  assert.equal(eventCandlesSvg(bars.slice(0, 1), { day0: 0, marks: [], flags: [] }), '');
  assert.equal(eventCandlesSvg([], { day0: 0, marks: [], flags: [] }), '');
  assert.equal(eventCandlesSvg(undefined, {}), '');
  // a flag or a mark off the window is left out
  const off = eventCandlesSvg(bars.slice(0, 40), { day0: 30, marks: [{ index: 45, label: 'gone', kind: 'other' }], flags: [{ index: 90, label: '60 天', text: '+2.0%', tone: 'up' }] });
  assert.doesNotMatch(off, /ew-flag|ew-mark"|gone/);
});

test('eventRelSvg: the line against the market on the window\'s bars, a dashed 100 and day 0; fewer than two points draw nothing', () => {
  const rel = [[-2, 98], [-1, 100], [0, 88.85], [1, 81.1], [70, 120]];
  const svg = eventRelSvg(rel, { day0: 30, count: 91 });
  assert.match(svg, /^<svg class="ew-rel" viewBox="0 0 640 110" role="img"/);
  const line = svg.match(/<path class="ew-rel-line" d="([^"]+)"/)[1];
  assert.equal(line.split(/[ML]/).filter(Boolean).length, 4, 'a point past the window is left out');
  assert.match(svg, /<line class="ew-rel-base" /);
  assert.match(svg, /<line class="ew-day0" /);
  assert.ok(svg.includes('>100</text>'));
  // the rel line's day 0 point sits on the candles' day 0
  const candles = eventCandlesSvg(windowBars(91), { day0: 30, marks: [], flags: [] });
  assert.equal(svg.match(/<line class="ew-day0" x1="([\d.]+)"/)[1], candles.match(/<line class="ew-day0" x1="([\d.]+)"/)[1]);
  assert.equal(eventRelSvg([[0, 100]], { day0: 30, count: 91 }), '');
  assert.equal(eventRelSvg(null, { day0: 30, count: 91 }), '');
});
