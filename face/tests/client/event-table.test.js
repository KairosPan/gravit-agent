// The event table's model (host/event-table.js): every figure a labelled percentage — one decimal, its sign always (U+2212
// for minus), the none word when there is none — the present case's anchors first, then each group in the view's order with
// its rows; a source kept only when http(s), and a link to the market page only for a measured row with a day 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pct, toneOf, marketHref, eventTableOf } from '../../client/js/host/event-table.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { EVENT_VIEW, EVENT_VIEW_ID } from './helpers/event-view.js';

const zh = fn => withTable(ZH, fn);
const rowOf = (table, id) => [...(table.present ?? []), ...table.groups.flatMap(g => g.rows)].find(r => r.id === id);

test('pct: one decimal, the sign always, U+2212 for minus, zero unsigned, none in the table\'s word', () => {
  assert.equal(pct(-0.112), '−11.2%');
  assert.equal(pct(0.02), '+2.0%');
  assert.equal(pct(0), '0.0%');
  assert.equal(pct(-0.0004), '0.0%', 'a figure that rounds to zero reads unsigned');
  assert.equal(zh(() => pct(null)), '尚无');
  assert.equal(pct(null), '—');
  assert.equal(pct(Number.NaN), '—');
  assert.equal(pct('0.1'), '—', 'a string is no figure');
});

test('toneOf: up above zero, down below, flat when it rounds to zero, none when there is no figure', () => {
  assert.equal(toneOf(0.02), 'up');
  assert.equal(toneOf(-0.112), 'down');
  assert.equal(toneOf(0), 'flat');
  assert.equal(toneOf(0.0004), 'flat');
  assert.equal(toneOf(null), 'none');
});

test('marketHref: the stock, its day 0, the view and the case, a dotted ticker kept as it is (Review Focus 5)', () => {
  assert.equal(marketHref('an-20261112-50c20b08', 'BRK.B', '2018-01-26', 'ev-BRK.B-2018-01-26'),
    '#/markets/stock:BRK.B?at=2018-01-26&view=an-20261112-50c20b08&case=ev-BRK.B-2018-01-26');
  assert.equal(marketHref('an-20261112-50c20b08', 'A&B', '2018-01-26', 'q-1'), '#/markets/stock:A%26B?at=2018-01-26&view=an-20261112-50c20b08&case=q-1');
});

test('the head: the title and the counts from the coverage', () => {
  const table = eventTableOf(EVENT_VIEW_ID, EVENT_VIEW);
  assert.equal(table.title, 'CEO 风波：创始人/职业经理人 × 被查在任/当天离任');
  assert.deepEqual(table.counts, { asked: 6, measured: 4, unmeasured: 2 });
});

test("a measured case's chips are 当天, 5 天 and 60 天 from x0, x5 and x60; its link opens the market at its day 0", () => {
  const table = zh(() => eventTableOf(EVENT_VIEW_ID, EVENT_VIEW));
  const wynn = rowOf(table, 'ev-WYNN-2018-01-26');
  assert.deepEqual(wynn.chips, [
    { label: '当天', text: '−11.2%', tone: 'down' },
    { label: '5 天', text: '−14.6%', tone: 'down' },
    { label: '60 天', text: '+2.0%', tone: 'up' },
  ]);
  assert.equal(wynn.href, marketHref(EVENT_VIEW_ID, 'WYNN', '2018-01-26', 'ev-WYNN-2018-01-26'));
  assert.deepEqual([wynn.symbol, wynn.label, wynn.date, wynn.timing, wynn.day0, wynn.shifted, wynn.measured, wynn.verified, wynn.claimed],
    ['WYNN', 'Wynn Resorts · Steve Wynn', '2018-01-26', 'open', '2018-01-26', false, true, true, true]);
  assert.equal(wynn.source, 'https://r.jina.ai/https://www.cbc.ca/lite/story/1.4505790');
  const jd = rowOf(table, 'ev-JD-2018-09-02');
  assert.deepEqual([jd.date, jd.day0, jd.shifted, jd.flags], ['2018-09-02', '2018-09-04', true, ['elsewhere']], 'a day 0 after the date is shifted');
  const en = rowOf(eventTableOf(EVENT_VIEW_ID, EVENT_VIEW), 'ev-WYNN-2018-01-26');
  assert.deepEqual(en.chips.map(c => c.label), ['Day 0', '5 days', '60 days']);
});

test("an anchor's chips are 当天, 次日, 5 天 and 60 天, the missing ones in the none word", () => {
  const table = zh(() => eventTableOf(EVENT_VIEW_ID, EVENT_VIEW));
  assert.deepEqual(table.present.map(r => r.id), ['q-1', 'q-2'], 'the present case first, one row per anchor');
  const q1 = table.present[0];
  assert.deepEqual(q1.chips, [
    { label: '当天', text: '−6.5%', tone: 'down' },
    { label: '次日', text: '−11.3%', tone: 'down' },
    { label: '5 天', text: '尚无', tone: 'none' },
    { label: '60 天', text: '尚无', tone: 'none' },
  ]);
  assert.deepEqual([q1.symbol, q1.date, q1.day0, q1.shifted, q1.verified, q1.note], ['NVDA', '2026-11-08', '2026-11-09', true, true, '周六公告，按周一算']);
  assert.equal(q1.href, marketHref(EVENT_VIEW_ID, 'NVDA', '2026-11-09', 'q-1'));
  assert.deepEqual([table.present[1].source, table.present[1].verified], [null, false]);
  assert.equal(eventTableOf(EVENT_VIEW_ID, { ...EVENT_VIEW, query: null }).present, null, 'no query, no present case');
  assert.equal(eventTableOf(EVENT_VIEW_ID, { ...EVENT_VIEW, query: { ...EVENT_VIEW.query, anchors: [] } }).present, null);
});

test('an unmeasured row has no chips and no link; its words come as they came', () => {
  const chk = rowOf(eventTableOf(EVENT_VIEW_ID, EVENT_VIEW), 'ev-CHK-2012-04-18');
  assert.deepEqual([chk.measured, chk.chips, chk.href, chk.day0, chk.shifted], [false, [], null, null, false]);
  assert.equal(chk.words, 'Nasdaq keeps no daily bars of CHK');
  assert.match(chk.source, /^https:\/\/www\.oklahoman\.com\//, 'its source link kept');
});

test('a source is kept only when http(s): a javascript: one, or none, is null and reads unverified', () => {
  const view = {
    ...EVENT_VIEW,
    query: { ...EVENT_VIEW.query, anchors: [{ ...EVENT_VIEW.query.anchors[0], source: 'javascript:alert(1)', verified: true }] },
    cases: EVENT_VIEW.cases.map(c => (c.id === 'ev-WYNN-2018-01-26' ? { ...c, source: 'javascript:alert(1)' } : c.id === 'ev-EFX-2017-09-07' ? { ...c, source: null } : c)),
  };
  const table = eventTableOf(EVENT_VIEW_ID, view);
  assert.deepEqual([table.present[0].source, table.present[0].verified], [null, false]);
  assert.deepEqual([rowOf(table, 'ev-WYNN-2018-01-26').source, rowOf(table, 'ev-WYNN-2018-01-26').verified], [null, false]);
  assert.deepEqual([rowOf(table, 'ev-EFX-2017-09-07').source, rowOf(table, 'ev-EFX-2017-09-07').verified], [null, false]);
  assert.equal(rowOf(table, 'ev-INFY-2019-10-21').verified, false, 'a case the view did not verify stays unverified');
});

test("the groups in the view's order, each with its count and measured; a summary only when it has medians", () => {
  const table = eventTableOf(EVENT_VIEW_ID, EVENT_VIEW);
  assert.deepEqual(table.groups.map(g => [g.name, g.count, g.measured, g.summary, g.rows.map(r => r.id)]), [
    ['A 创始人/被查·在任', 3, 2, null, ['ev-WYNN-2018-01-26', 'ev-JD-2018-09-02', 'ev-CHK-2012-04-18']],
    ['C 经理人/被查·在任', 3, 2, null, ['ev-EFX-2017-09-07', 'ev-INFY-2019-10-21', 'ev-WPPGY-2018-04-03']],
  ]);
  const named = EVENT_VIEW.groups.named.map((g, i) => (i === 0 ? { ...g, summary: { ...g.summary, n: 9, x0: -0.0312, x60: 0.0841 } } : g));
  const withMedians = eventTableOf(EVENT_VIEW_ID, { ...EVENT_VIEW, groups: { ...EVENT_VIEW.groups, named } });
  assert.deepEqual(withMedians.groups[0].summary, { x0: -0.0312, x60: 0.0841 });
  assert.equal(withMedians.groups[1].summary, null);
});

test('a view with no named group draws its cases under one group of no name; a broken view draws an empty table', () => {
  const table = eventTableOf(EVENT_VIEW_ID, { ...EVENT_VIEW, groups: { all: EVENT_VIEW.groups.all, named: [] }, cases: EVENT_VIEW.cases.map(c => ({ ...c, group: null })) });
  assert.deepEqual(table.groups.map(g => [g.name, g.count]), [[null, 6]]);
  assert.deepEqual(eventTableOf(EVENT_VIEW_ID, null), { title: '', counts: { asked: 0, measured: 0, unmeasured: 0 }, present: null, groups: [] });
});
