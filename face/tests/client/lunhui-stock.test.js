// Plan 3 of the Lunhui run view, task 4: the stock drawer — its derived headline and note, the minute line against the
// view's limits (the limit lines, the seal marks, the volume bars), the stock cursor's readout, and the drawer itself with its
// states; on the synthetic sealed 10-27 run's view (VIEW_1027) and on small hand-made StockFacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockHeadline, stockNote, stockDrawerHtml } from '../../client/js/render/lunhui/stock.js';
import { chartGeometry, intradaySvg, cursorPatch } from '../../client/js/render/lunhui/intraday.js';
import { VIEW_1027 } from './helpers/lunhui-view.js';

const text = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// a 242-point line about `prec`: price(i) for the grid index i, volume rising by the minute
const line = (prec, price) => ({ prec, price: Array.from({ length: 242 }, (_, i) => price(i)), volume: Array.from({ length: 242 }, (_, i) => 100 + i), amount: Array.from({ length: 242 }, (_, i) => 1000 * (i + 1)) });
const facts = over => ({
  code: '600100', symbol: 'sh600100', name: '样本甲', industry: '电力', pool: 'zt', price: 11, pct: 10, boards: 3, tried: null,
  yesterdayBoards: 2, firstSeal: '09:34', lastSeal: '13:55', breaks: 0, sealFunds: 50000000, limitPrice: null, turnover: 4.5,
  amount: 300000000, limitUp: 11, limitDown: 9, minutes: null, minutesMissing: null, cited: [], ...over,
});
const KEY = 'cn-market/r1/';
const stateOf = (stocks, code, over = {}) => ({
  lunhui: { views: { [KEY]: { status: 'loaded', view: { strategy: 'cn-market', run: 'r1', frozenAt: '2026-10-27T07:05:00Z', indices: { rows: [] }, stocks } } }, ui: {}, stock: { key: KEY, code }, ...over },
});

// ---- the headline and the note, one case per rule ----

test('stockHeadline: a limit-up that broke says when it held from', () => {
  // sealed 09:34, broke at 09:36, at the limit again from 09:37 on
  const f = facts({ breaks: 1, minutes: line(10, i => (i < 4 ? 10.5 : i === 6 ? 10.9 : 11)) });
  assert.equal(stockHeadline(f), 'Sealed 09:34, broke 1×, held from 09:37 to the close');
  assert.equal(stockNote(f), null);
});

test('stockHeadline: a limit-up with no break held to the close', () => {
  const f = facts({ firstSeal: '09:30', minutes: line(10, () => 11) });
  assert.equal(stockHeadline(f), 'Sealed 09:30 and held to the close');
  assert.equal(stockNote(f), null);
});

test('stockNote: breaks the minute line does not show fell inside a minute', () => {
  const f = facts({ breaks: 2, minutes: line(10, i => (i < 4 ? 10.5 : 11)) });
  assert.equal(stockHeadline(f), 'Sealed 09:34, broke 2×, held from 09:34 to the close');
  assert.equal(stockNote(f), 'each break fell inside a minute, so the minute line never leaves the limit');
});

test('stockHeadline: a broken board that touched the limit in a minute', () => {
  const f = facts({ pool: 'zb', boards: null, tried: 2, breaks: 1, firstSeal: '09:36', minutes: line(10, i => (i >= 6 && i <= 8 ? 11 : 10.6)) });
  assert.equal(stockHeadline(f), 'Touched the limit at 09:36, broke, open at the close');
  assert.equal(stockNote(f), null);
});

test('stockHeadline and stockNote: a broken board no minute of which closed at the limit', () => {
  // 10.99 is below 11 − 0.005
  const f = facts({ pool: 'zb', boards: null, tried: 2, breaks: 1, firstSeal: '10:05', minutes: line(10, i => (i === 35 ? 10.99 : 10.6)) });
  assert.equal(stockHeadline(f), 'Touched the limit at 10:05 and broke');
  assert.equal(stockNote(f), 'touched 10:05 and broke; no minute closed at the limit');
});

test("stockHeadline: yesterday's board, its high and its close, at the limit-down when it closed there", () => {
  const down = facts({ pool: 'yesterday', boards: null, yesterdayBoards: 3, firstSeal: null, lastSeal: null, breaks: null, minutes: line(10, i => (i === 1 ? 10.66 : i === 241 ? 9 : 9.8)) });
  assert.equal(stockHeadline(down), "Yesterday's 3-board: high +6.60% at 09:31, closed −10.00% at the limit-down");
  assert.equal(stockNote(down), null);
  const open = { ...down, minutes: line(10, i => (i === 1 ? 10.66 : i === 241 ? 9.5 : 9.8)) };
  assert.equal(stockHeadline(open), "Yesterday's 3-board: high +6.60% at 09:31, closed −5.00%");
});

test('with no minute line the headline is the pool tag, and the note names why', () => {
  const first = facts({ boards: 1, minutesMissing: 'NOT_FROZEN' });
  assert.equal(stockHeadline(first), 'limit-up · 1 boards');
  assert.equal(stockNote(first), 'no minute line frozen for first boards');
  const firstTry = facts({ pool: 'zb', boards: null, tried: 1, minutesMissing: 'NOT_FROZEN' });
  assert.equal(stockHeadline(firstTry), 'broke · 1-board try');
  assert.equal(stockNote(firstTry), 'no minute line frozen for first boards');
  const failed = facts({ boards: 4, minutesMissing: 'PROVIDER_HTTP_ERROR' });
  assert.equal(stockHeadline(failed), 'limit-up · 4 boards');
  assert.equal(stockNote(failed), 'no minute line frozen (PROVIDER_HTTP_ERROR)');
  const y = facts({ pool: 'yesterday', boards: null, yesterdayBoards: 3, minutesMissing: 'NOT_FROZEN' });
  assert.equal(stockHeadline(y), "yesterday's 3-board");
  assert.equal(stockNote(y), 'no minute line frozen (NOT_FROZEN)');
});

test('a null number in the headline draws a dash, never a zero', () => {
  assert.equal(stockHeadline(facts({ boards: null })), 'limit-up · — boards');
  assert.equal(stockHeadline(facts({ firstSeal: null, minutes: line(10, () => 11) })), 'Sealed — and held to the close');
});

// ---- the limits ----

test("a 20% code's limit line sits at the view's limitUp", () => {
  // a ChiNext name: +20% from 10 is 12; the limit-down here is put out of the drawn range on purpose
  const minutes = line(10, i => (i < 100 ? 10 + i * 0.02 : 12));
  const limits = { up: 12, down: 7.5 };
  const g = chartGeometry(minutes, limits);
  assert.ok(Math.abs(g.span - 2 * 1.08) < 1e-9, 'the span reaches the limit-up with 8% air');
  const svg = intradaySvg(minutes, { id: 's-300100', limits, seals: { first: '11:10', last: null }, bars: 'volume' });
  const up = /<line class="lh-limit up" x1="56" y1="([\d.]+)" x2="708" y2="([\d.]+)"/.exec(svg);
  assert.ok(up, 'the limit-up line is drawn');
  assert.equal(Number(up[1]), Number(g.Y(12).toFixed(1)));
  assert.doesNotMatch(svg, /lh-limit down/, 'a limit-down outside the drawn range is not drawn');
  // the first seal sits on the limit line at its grid minute (11:10 is point 100)
  assert.match(svg, new RegExp(`<circle class="lh-seal" cx="${Number(g.X(100).toFixed(1))}" cy="${up[1]}"`));
  assert.equal((svg.match(/lh-seal/g) ?? []).length, 1, 'no last seal, no second mark');
  // in range, the limit-down is drawn too
  assert.match(intradaySvg(minutes, { id: 'x', limits: { up: 12, down: 8 } }), /<line class="lh-limit down"/);
  // no option, no limit and no seal
  assert.doesNotMatch(intradaySvg(minutes, { id: 'x' }), /lh-limit|lh-seal/);
});

test('bars: volume scales the bars to the busiest minute by volume; the default stays the amount', () => {
  const minutes = { prec: 10, price: [10, 10.1, 10.2], volume: [10, 40, 20], amount: [300, 100, 200] };
  const heights = svg => [...svg.matchAll(/<rect class="lh-bar [a-z]+"[^>]*height="([\d.]+)"/g)].map(x => Number(x[1]));
  assert.deepEqual(heights(intradaySvg(minutes, { id: 'x', bars: 'volume' })), [9, 36, 18]);
  assert.deepEqual(heights(intradaySvg(minutes, { id: 'x' })), [36, 12, 24]);
});

test('the stock readout says at the limit-up only at that price', () => {
  const f = facts({ code: '300100', symbol: 'sz300100', name: '创业样本', limitUp: 12, limitDown: 8, minutes: line(10, i => (i === 10 ? 11.98 : 12)) });
  const view = { indices: { rows: [] }, stocks: { 300100: f } };
  assert.equal(cursorPatch(view, 'sz300100', 0).readout, '创业样本 · 09:30 · 12.00 · +20.00% · at the limit-up');
  assert.equal(cursorPatch(view, 'sz300100', 10).readout, '创业样本 · 09:40 · 11.98 · +19.80%');
  const low = { ...f, minutes: line(10, () => 8) };
  assert.equal(cursorPatch({ indices: { rows: [] }, stocks: { 300100: low } }, 'sz300100', 5).readout, '创业样本 · 09:35 · 8.00 · −20.00% · at the limit-down');
  // the cursor stands where the drawer's chart drew the point, on the limits' geometry
  const g = chartGeometry(f.minutes, { up: 12, down: 8 });
  assert.equal(cursorPatch(view, 'sz300100', 0).y, Number(g.Y(12).toFixed(1)));
  // an index's readout is unchanged
  assert.match(cursorPatch(VIEW_1027, 'sh000001', 0).readout, /^上证指数 · 09:30 · [\d.]+ · [+−]?[\d.]+% · ¥[^ ]+ this minute$/);
  assert.equal(cursorPatch(view, 'sz999999', 0), null);
});

// ---- the drawer ----

test('the drawer draws its header, pool line, minute line, tiles, citations and buttons', () => {
  const s = { lunhui: { views: { [KEY]: { status: 'loaded', view: VIEW_1027 } }, ui: {}, stock: { key: KEY, code: '600011' } } };
  const html = stockDrawerHtml(s);
  assert.match(html, /^<aside class="drawer stock" aria-label="样本600011">/);
  assert.match(html, /<h2>样本600011<\/h2>/);
  assert.match(text(html), /600011 · SH main board · 通用设备/);
  assert.match(html, /<button type="button" class="close-key" data-action="lunhuiStockClose" aria-label="Close">×<\/button>/);
  assert.match(text(html), /22\.01\+10\.00%limit-up · 4 boards/);
  assert.match(text(html), /From the limit-up pool frozen 10-28 04:16 CST by the market run/);
  assert.match(text(html), /Sealed 09:25, broke 1×, held from 09:34 to the close/);
  assert.match(html, /<line class="lh-limit up"/);
  assert.match(html, /<circle class="lh-seal"/);
  assert.match(html, /<svg class="lh-chart" data-action="lunhuiHover" data-last="241" data-id="s-600011" data-strategy="cn-market" data-run="20261027T201627Z-6937d208" data-symbol="sh600011"/);
  assert.match(html, /<input type="range" id="minute-s-600011" class="lh-minute" data-action="lunhuiMinute" data-id="s-600011" data-strategy="cn-market" data-run="20261027T201627Z-6937d208" data-symbol="sh600011" min="0" max="241" value="241"/);
  assert.match(html, /id="cur-s-600011"/);
  assert.match(html, /<div class="lh-readout" id="read-s-600011" role="status" aria-live="polite">样本600011 · 15:00 · 22\.01 · \+10\.00% · at the limit-up<\/div>/);
  for (const t of ['Seal funds¥80000000', 'Limit price22.01', 'Turnover9.39%', 'Amount¥1.17亿']) assert.ok(text(html).includes(t), t);
  assert.ok(text(html).includes('No claim cites it; it is in the limit-up pool only.'));
  assert.match(html, /data-action="lunhuiAsk"[^>]*>Ask Gravit about 样本600011<\/button>/);
  assert.match(html, /data-action="lunhuiMarkets"[^>]*>Open in Markets<\/button>/);
  assert.equal(stockDrawerHtml({ lunhui: { views: {}, ui: {}, stock: null } }), '', 'no stock open, no drawer');
  assert.equal(stockDrawerHtml({}), '');
});

test('a stock with no minute line opens with facts, tiles, citations and the note, and no chart', () => {
  // a first board (M6), and a name whose minute freeze failed
  for (const [code, note] of [['002001', 'no minute line frozen for first boards'], ['600012', 'no minute line frozen (PROVIDER_HTTP_ERROR)']]) {
    const s = { lunhui: { views: { [KEY]: { status: 'loaded', view: VIEW_1027 } }, ui: {}, stock: { key: KEY, code } } };
    const html = stockDrawerHtml(s);
    const f = VIEW_1027.stocks[code];
    assert.match(html, new RegExp(`<h2>${f.name}</h2>`), code);
    assert.ok(text(html).includes(`${code} · SZ main board · `) || text(html).includes(`${code} · SH main board · `), code);
    assert.ok(text(html).includes(`limit-up · ${f.boards} boards`), code);
    assert.ok(text(html).includes('From the limit-up pool frozen'), code);
    assert.ok(text(html).includes('Seal funds') && text(html).includes('Turnover') && text(html).includes('Amount'), code);
    assert.ok(text(html).includes('No claim cites it'), code);
    assert.ok(text(html).includes(note), code);
    assert.doesNotMatch(html, /<svg|lunhuiMinute|lunhuiHover|read-s-/, `${code}: no chart and no slider`);
    assert.match(html, /data-action="lunhuiAsk"/);
  }
});

test("the drawer's tiles by pool: a broken board's limit price, yesterday's boards", () => {
  const zb = stockDrawerHtml(stateOf({ 600100: facts({ pool: 'zb', boards: null, tried: 2, limitPrice: 11, sealFunds: null }) }, '600100'));
  assert.ok(text(zb).includes('broke · 2-board try'));
  assert.ok(text(zb).includes('Limit price11.00'));
  assert.ok(!text(zb).includes('Seal funds'));
  const y = stockDrawerHtml(stateOf({ 600100: facts({ pool: 'yesterday', boards: null, yesterdayBoards: 3, pct: -9.91, turnover: null, amount: null }) }, '600100'));
  assert.ok(text(y).includes("yesterday's 3-board"));
  assert.ok(text(y).includes("Yesterday's boards3"));
  assert.ok(text(y).includes('Turnover—') && text(y).includes('Amount—'), 'a null tile is a dash');
  assert.match(y, /<span class="chip down">−9\.91%<\/span>/);
  const nul = stockDrawerHtml(stateOf({ 600100: facts({ price: null, pct: null }) }, '600100'));
  assert.match(nul, /<span class="lh-stk-price">—<\/span><span class="chip grey">—<\/span>/, 'no price, no change: dashes');
});

test("the drawer's states: loading, failed, not in this run", () => {
  const loading = stockDrawerHtml({ lunhui: { views: { [KEY]: { status: 'loading' } }, ui: {}, stock: { key: KEY, code: '600001' } } });
  assert.match(loading, /class="drawer stock"/);
  assert.ok(text(loading).includes('Loading 600001…'));
  assert.match(loading, /data-action="lunhuiStockClose"/);
  const unread = stockDrawerHtml({ lunhui: { views: {}, ui: {}, stock: { key: KEY, code: '600001' } } });
  assert.ok(text(unread).includes('Loading 600001…'), 'a view not asked yet is loading too');
  const failed = stockDrawerHtml({ lunhui: { views: { [KEY]: { status: 'failed', error: 'HTTP <404>' } }, ui: {}, stock: { key: KEY, code: '600001' } } });
  assert.ok(failed.includes('HTTP &lt;404&gt;'), 'the error words, escaped');
  const missing = stockDrawerHtml(stateOf({}, '999999'));
  assert.ok(text(missing).includes("999999 is not in this run's pools."));
  assert.doesNotMatch(missing, /lunhuiAsk/);
});

test('In this run lists citations as written, escaped; none says the pool-only line', () => {
  const cited = [{ module: 'sentiment', id: 'c3', text: '<b>样本甲</b> 五连板 & 断层' }, { module: 'counterevidence', id: 'r1', text: '反证：量能不足' }];
  const html = stockDrawerHtml(stateOf({ 600100: facts({ cited }) }, '600100'));
  assert.ok(html.includes('&lt;b&gt;样本甲&lt;/b&gt; 五连板 &amp; 断层'), 'escaped');
  assert.doesNotMatch(html, /<b>样本甲/);
  assert.ok(text(html).includes('sentiment · c3'));
  assert.ok(text(html).includes('counterevidence · r1反证：量能不足'));
  assert.ok(text(html).indexOf('sentiment · c3') < text(html).indexOf('counterevidence · r1'), 'in order');
  assert.ok(!text(html).includes('No claim cites it'));
  assert.ok(text(stockDrawerHtml(stateOf({ 600100: facts() }, '600100'))).includes('No claim cites it; it is in the limit-up pool only.'));
});

test('the drawer escapes the name, the industry and the code it was asked', () => {
  const html = stockDrawerHtml(stateOf({ 600100: facts({ name: '<i>甲</i>', industry: 'A&B' }) }, '600100'));
  assert.doesNotMatch(html, /<i>甲/);
  assert.ok(html.includes('&lt;i&gt;甲&lt;/i&gt;'));
  assert.ok(html.includes('A&amp;B'));
  assert.doesNotMatch(stockDrawerHtml(stateOf({}, '<x>')), /<x>/);
});

// Review Focus 5 of plan 2, again: stamps print in China time whatever the browser's zone
test('the drawer under New York time reads China time', () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(new Date('2026-10-27T07:05:00Z').getHours(), 3, 'the process really is in New York');
    const html = stockDrawerHtml(stateOf({ 600100: facts({ minutes: line(10, () => 11), firstSeal: '09:30' }) }, '600100'));
    assert.ok(text(html).includes('From the limit-up pool frozen 10-27 15:05 CST by the market run'));
    assert.ok(text(html).includes('Sealed 09:30 and held to the close'));
    assert.ok(text(html).includes('样本甲 · 15:00 · 11.00 · +10.00% · at the limit-up'));
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});
