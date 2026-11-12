// The market page at an event (spec 2026-11-12 §4.3): the route keeps the market id and reads `at`, `view` and `case` after
// it, for a stock alone; the event's window is 30 sessions before the bar of its New York day through 60 after, read from the
// US stocks line by a dated ask; and the marks are the case's day 0, then the other events of the same symbol in the view that
// fall on a bar of the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, toHash } from '../../client/js/router.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { wantedAnalog } from '../../client/js/host/analog.js';
import { marketHref } from '../../client/js/host/event-table.js';
import { nyDay, windowAsk, eventWindowOf, windowPath, marksOf } from '../../client/js/host/event-window.js';
import { EVENT_VIEW, EVENT_VIEW_ID, EVENT_VIEW_WITH_B } from './helpers/event-view.js';

const DAY = 86_400_000;
// weekday daily bars from a Monday, each starting at 14:30 UTC (09:30 in New York in winter, 10:30 in summer: the same day)
function weekdays(from, n) {
  const bars = [];
  for (let t = Date.parse(`${from}T14:30:00Z`); bars.length < n; t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const c = 100 + bars.length;
    bars.push({ t, o: c, h: c + 1, l: c - 1, c, v: 1000 });
  }
  return bars;
}
const BARS = weekdays('2017-10-02', 200);
const AT = '2018-01-26';

test('a stock link with its event round-trips through the router, a dotted ticker kept as it is (Review Focus 5)', () => {
  const hash = '#/markets/stock:BRK.B?at=2018-01-26&view=an-20261112-50c20b08&case=ev-BRK.B-2018-01-26';
  assert.deepEqual(parseHash(hash), { screen: 'markets', id: 'stock:BRK.B', event: { at: '2018-01-26', view: 'an-20261112-50c20b08', case: 'ev-BRK.B-2018-01-26' } });
  assert.equal(toHash(parseHash(hash)), hash);
  // the table's own link is that hash
  const href = marketHref(EVENT_VIEW_ID, 'BRK.B', '2018-01-26', 'ev-BRK.B-2018-01-26');
  assert.equal(toHash(parseHash(href)), href);
  // `at` alone
  assert.deepEqual(parseHash('#/markets/stock:WYNN?at=2018-01-26'), { screen: 'markets', id: 'stock:WYNN', event: { at: '2018-01-26' } });
  assert.equal(toHash(parseHash('#/markets/stock:WYNN?at=2018-01-26')), '#/markets/stock:WYNN?at=2018-01-26');
  // a page opened without `at` behaves as today
  assert.deepEqual(parseHash('#/markets/stock:WYNN'), { screen: 'markets', id: 'stock:WYNN' });
  assert.equal(toHash({ screen: 'markets', id: 'stock:WYNN' }), '#/markets/stock:WYNN');
});

test('a bad `at` gives no event; a coin ignores the query; a coin keeps its slash', () => {
  for (const at of ['2018-1-26', '2018-02-30', 'yesterday', '']) {
    assert.deepEqual(parseHash(`#/markets/stock:WYNN?at=${at}&view=v&case=c`), { screen: 'markets', id: 'stock:WYNN' }, at);
  }
  assert.deepEqual(parseHash('#/markets/stock:WYNN?view=v&case=c'), { screen: 'markets', id: 'stock:WYNN' }, 'no at');
  assert.deepEqual(parseHash('#/markets/coin:BTC?at=2018-01-26&view=v'), { screen: 'markets', id: 'coin:BTC' });
  assert.deepEqual(parseHash('#/markets/crypto:BTC/USD'), { screen: 'markets', id: 'crypto:BTC/USD' });
  assert.equal(toHash({ screen: 'markets', id: 'coin:BTC', event: { at: '2018-01-26' } }), '#/markets/coin:BTC', 'only a stock writes its event');
});

test('nav keeps a stock page’s event, and the page wants its view', () => {
  const hash = marketHref(EVENT_VIEW_ID, 'WYNN', AT, 'ev-WYNN-2018-01-26');
  const s = reducers.nav(emptyState(), parseHash(hash));
  assert.deepEqual(s.route, { screen: 'markets', id: 'stock:WYNN', event: { at: AT, view: EVENT_VIEW_ID, case: 'ev-WYNN-2018-01-26' } });
  assert.deepEqual(wantedAnalog(s).views, [EVENT_VIEW_ID]);
  assert.deepEqual(reducers.nav(emptyState(), { screen: 'markets', id: 'stock:WYNN' }).route, { screen: 'markets', id: 'stock:WYNN' });
  assert.deepEqual(reducers.nav(emptyState(), { screen: 'markets', id: 'coin:BTC', event: { at: AT } }).route, { screen: 'markets', id: 'coin:BTC' });
});

test('nyDay: a bar’s New York day, a session open in winter and in summer', () => {
  assert.equal(nyDay(Date.parse('2018-01-26T14:30:00Z')), '2018-01-26');
  assert.equal(nyDay(Date.parse('2018-07-02T13:30:00Z')), '2018-07-02');
  assert.equal(nyDay(Date.parse('2018-01-27T03:00:00Z')), '2018-01-26', 'late evening in New York is still its day');
});

test('windowAsk: 60 days before `at` to the lesser of now and 100 days after, 200 bars; windowPath asks the US stocks line', () => {
  const at = Date.UTC(2018, 0, 26);
  assert.deepEqual(windowAsk(AT, Date.parse('2026-11-12T00:00:00Z')), { since: at - 60 * DAY, before: at + 100 * DAY, limit: 200 });
  assert.deepEqual(windowAsk(AT, Date.parse('2026-11-12T00:00:00Z')), { since: 1511740800000, before: 1525564800000, limit: 200 });
  const soon = Date.parse('2018-02-15T20:00:00Z');
  assert.deepEqual(windowAsk(AT, soon), { since: 1511740800000, before: soon, limit: 200 });
  assert.equal(windowPath('BRK.B', windowAsk(AT, soon)),
    `/data/market/candles?venue=cboe&symbol=BRK.B&interval=1d&since=1511740800000&before=${soon}&limit=200`);
  assert.equal(windowPath('A&B', { since: 1, before: 2, limit: 200 }), '/data/market/candles?venue=cboe&symbol=A%26B&interval=1d&since=1&before=2&limit=200');
});

test('eventWindowOf: 30 before through 60 after the bar of `at`; fewer after when the bars end sooner (Review Focus 2)', () => {
  const w = eventWindowOf(BARS, AT);
  assert.equal(w.bars.length, 91);
  assert.equal(w.day0, 30);
  assert.equal(nyDay(w.bars[30].t), AT);
  const i = BARS.findIndex(b => nyDay(b.t) === AT);
  const short = eventWindowOf(BARS.slice(0, i + 13), AT);
  assert.equal(short.bars.length, 43);
  assert.equal(short.day0, 30);
  const early = eventWindowOf(BARS.slice(i - 10), AT);
  assert.equal(early.day0, 10, 'fewer than 30 before: the bars there are');
  assert.equal(eventWindowOf(BARS, '2018-01-27'), null, 'no bar on a Saturday');
  assert.equal(eventWindowOf([], AT), null);
  assert.equal(eventWindowOf(null, AT), null);
});

test('marksOf: the case’s day 0, then the other events of its symbol on a bar of the window, each with its label and group', () => {
  const w = eventWindowOf(BARS, AT);
  assert.deepEqual(marksOf(EVENT_VIEW_WITH_B, 'ev-WYNN-2018-01-26', w), [
    { index: 30, label: 'Wynn Resorts · Steve Wynn', group: 'A 创始人/被查·在任', kind: 'day0' },
    { index: 38, label: 'Wynn Resorts · Steve Wynn resigns', group: 'B 创始人/当天离任', kind: 'other' },
  ]);
  // opened from the second event: its own day 0, the first the other
  const b = eventWindowOf(BARS, '2018-02-07');
  assert.deepEqual(marksOf(EVENT_VIEW_WITH_B, 'ev-WYNN-2018-02-06', b), [
    { index: 30, label: 'Wynn Resorts · Steve Wynn resigns', group: 'B 创始人/当天离任', kind: 'day0' },
    { index: 22, label: 'Wynn Resorts · Steve Wynn', group: 'A 创始人/被查·在任', kind: 'other' },
  ]);
  // the view as the table has it: WYNN's one event, nothing else of its symbol
  assert.deepEqual(marksOf(EVENT_VIEW, 'ev-WYNN-2018-01-26', w), [{ index: 30, label: 'Wynn Resorts · Steve Wynn', group: 'A 创始人/被查·在任', kind: 'day0' }]);
  // an anchor: the present symbol's other anchors, no group
  const nvda = { bars: weekdays('2026-09-28', 34), day0: 0 };
  nvda.day0 = nvda.bars.findIndex(x => nyDay(x.t) === '2026-11-09');
  assert.deepEqual(marksOf(EVENT_VIEW, 'q-1', nvda), [
    { index: nvda.day0, label: '董事会宣布独立调查', group: null, kind: 'day0' },
    { index: nvda.day0 + 1, label: '股东集体诉讼', group: null, kind: 'other' },
  ]);
  // a view that is gone, or a case not in it: day 0 alone, unlabelled
  assert.deepEqual(marksOf(null, 'ev-WYNN-2018-01-26', w), [{ index: 30, label: '', group: null, kind: 'day0' }]);
  assert.deepEqual(marksOf(EVENT_VIEW, 'ev-nope', w), [{ index: 30, label: '', group: null, kind: 'day0' }]);
  assert.deepEqual(marksOf(EVENT_VIEW, 'ev-WYNN-2018-01-26', null), []);
});
