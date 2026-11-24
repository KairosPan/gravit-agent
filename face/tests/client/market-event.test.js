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
import { eventOf, eventHistoryHtml } from '../../client/js/render/event-window.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { EVENT_VIEW, EVENT_VIEW_ID, EVENT_VIEW_WITH_B, EVENT_VIEW_V2, EVENT_VIEW_V2_ID, EVENT_VIEW_V2_RAW } from './helpers/event-view.js';

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

// ---- the event analog redesign (Task 10): a version 2 view's page follows its horizons and draws its price

test('after round-trips through the router, past 60 alone', () => {
  const hash = '#/markets/stock:IPO?at=2026-11-19&view=an-20261124-0000beef&case=ev-IPO-2026-11-19&after=250';
  assert.deepEqual(parseHash(hash), { screen: 'markets', id: 'stock:IPO', event: { at: '2026-11-19', view: 'an-20261124-0000beef', case: 'ev-IPO-2026-11-19', after: 250 } });
  assert.equal(toHash(parseHash(hash)), hash);
  assert.equal(toHash(parseHash(marketHref('an-20261124-0000beef', 'IPO', '2026-11-19', 'ev-IPO-2026-11-19', 250))), hash);
  for (const after of ['60', '0', '999', 'x', '61.5', '']) {
    const parsed = parseHash(`#/markets/stock:IPO?at=2026-11-19&view=v&case=c&after=${after}`);
    assert.deepEqual(parsed, { screen: 'markets', id: 'stock:IPO', event: { at: '2026-11-19', view: 'v', case: 'c' } }, after);
    assert.equal(toHash(parsed), '#/markets/stock:IPO?at=2026-11-19&view=v&case=c');
  }
  assert.equal(parseHash('#/markets/stock:IPO?at=2026-11-19&after=61').event.after, 61);
  assert.equal(toHash({ screen: 'markets', id: 'stock:IPO', event: { at: '2026-11-19', after: 60 } }), '#/markets/stock:IPO?at=2026-11-19');
});

test("windowAsk keeps today's ask at 60 and grows past it", () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  const day = Date.UTC(2018, 0, 26);
  assert.deepEqual(windowAsk(AT, now), { since: day - 60 * DAY, before: day + 100 * DAY, limit: 200 });
  assert.deepEqual(windowAsk(AT, now, 60), windowAsk(AT, now));
  const far = Date.parse('2030-01-01T00:00:00Z');
  const ask = windowAsk(AT, far, 250);
  assert.equal(ask.limit, 390);
  assert.equal((ask.before - day) / DAY, 404);
  assert.equal(ask.since, day - 60 * DAY);
  assert.equal(windowAsk(AT, far, 120).limit, 260);
  assert.equal((windowAsk(AT, far, 120).before - day) / DAY, 196);
  const soon = Date.parse('2018-06-01T00:00:00Z');
  assert.equal(windowAsk(AT, soon, 250).before, soon, 'never past now');
});

test('eventWindowOf takes the after it is given', () => {
  const longer = weekdays('2017-10-02', 400);
  const w = eventWindowOf(longer, AT, 120);
  assert.equal(w.bars.length, 30 + 1 + 120);
  assert.equal(w.day0, 30);
  assert.equal(nyDay(w.bars[30].t), AT);
  // where the bars reach: the file's BARS end 115 sessions after day 0
  const i = BARS.findIndex(b => nyDay(b.t) === AT);
  assert.equal(eventWindowOf(BARS, AT, 120).bars.length, 30 + (BARS.length - i));
  assert.equal(eventWindowOf(BARS, AT, 250).bars.length, 30 + (BARS.length - i));
  assert.equal(eventWindowOf(BARS, AT).bars.length, 91);
});

const stateAt = (route, views, windows) => ({ route, analog: { tasks: {}, views }, markets: { event: windows } });
const ready = candles => ({ status: 'ready', data: { candles, source: 'Nasdaq · X', adjustment: 'split-adjusted, not dividend-adjusted' }, at: 0 });
const flagsOf = h => [...h.matchAll(/<g class="ew-flag [a-z]+">[^]*?<text[^>]*>([^<]+)<\/text><\/g>/g)].map(m => m[1]);
const NOW = Date.parse('2026-11-24T15:00:00Z');

test("a version 1 view's page is today's (Review Focus 5)", () => {
  const route = parseHash(marketHref(EVENT_VIEW_ID, 'WYNN', AT, 'ev-WYNN-2018-01-26'));
  assert.equal(route.event.after, undefined);
  const s = stateAt(route, { [EVENT_VIEW_ID]: { status: 'loaded', view: EVENT_VIEW } }, { 'stock:WYNN@2018-01-26': ready(BARS) });
  const ev = eventOf(s, 'stock:WYNN');
  assert.equal(ev.key, 'stock:WYNN@2018-01-26');
  assert.equal(ev.after, 60);
  assert.equal(ev.bars.status, 'ready');
  assert.deepEqual(windowAsk(AT, NOW, ev.after), { since: Date.UTC(2018, 0, 26) - 60 * DAY, before: Date.UTC(2018, 0, 26) + 100 * DAY, limit: 200 });
  const h = withTable(ZH, () => eventHistoryHtml(ev, NOW));
  assert.deepEqual(flagsOf(h), ['5 天 −14.6%', '60 天 +2.0%'], 'flags at +5 and +60 only');
  assert.doesNotMatch(h, /ev-level/);
  assert.match(h, /<div class="ew-rel-head">相对大盘（SPY）· 消息前一天 = 100<\/div>/);
  // a v1 link carrying an after (never written by the table) still keys its own window
  const wide = eventOf(stateAt({ ...route, event: { ...route.event, after: 120 } }, {}, {}), 'stock:WYNN');
  assert.equal(wide.key, 'stock:WYNN@2018-01-26@120');
});

// SPLB's listing on 2019-05-10: day 0 is its first bar; its price 160 over its ×4 split, 40 in the bars' units
const SPLB = 'ev-SPLB-2019-05-10';
const REL = Array.from({ length: 251 }, (_, k) => [k, 100 + k / 10]);
const withRel = (view, relOf) => ({ ...view, cases: view.cases.map(c => (c.id === SPLB ? { ...c, rel: REL, relOf } : c)) });
const splbPage = (view, n, after = 250) => {
  const route = parseHash(marketHref(EVENT_VIEW_V2_ID, 'SPLB', '2019-05-10', SPLB, after));
  const key = after > 60 ? `stock:SPLB@2019-05-10@${after}` : 'stock:SPLB@2019-05-10';
  const ev = eventOf(stateAt(route, { [EVENT_VIEW_V2_ID]: { status: 'loaded', view } }, { [key]: ready(weekdays('2019-05-10', n)) }), 'stock:SPLB');
  return { ev, h: withTable(ZH, () => eventHistoryHtml(ev, NOW)) };
};

test("a version 2 view's flags are its horizons and its price is a level", () => {
  const { ev, h } = splbPage(withRel(EVENT_VIEW_V2, 'benchmark'), 260);
  assert.equal(ev.after, 250);
  assert.equal(ev.key, 'stock:SPLB@2019-05-10@250');
  // every horizon after day 0, its figure against the benchmark
  assert.deepEqual(flagsOf(h), ['5 天 −11.2%', '20 天 −3.9%', '60 天 +2.9%', '120 天 +15.4%', '250 天 +22.1%']);
  assert.equal([...h.matchAll(/class="ev-level"/g)].length, 1);
  assert.match(h, /<div class="ew-rel-head">相对 SPY · 起算价 = 100<\/div>/);
  // the window: a listing has no bar before, day 0 then 250 after
  assert.match(h, /2019-05-10 至 2020-04-24/);
  // fewer bars: the flags the bars reach
  const short = splbPage(withRel(EVENT_VIEW_V2, 'benchmark'), 130).h;
  assert.deepEqual(flagsOf(short), ['5 天 −11.2%', '20 天 −3.9%', '60 天 +2.9%', '120 天 +15.4%']);
  // raw: the changes themselves, and the line its own path
  const raw = splbPage(withRel(EVENT_VIEW_V2_RAW, 'self'), 260).h;
  assert.deepEqual(flagsOf(raw), ['5 天 −9.9%', '20 天 −1.0%', '60 天 +6.3%', '120 天 +22.1%', '250 天 +33.5%']);
  assert.match(raw, /<div class="ew-rel-head">自身走势 · 起算价 = 100<\/div>/);
  // no price level outside the price base
  const open = { ...EVENT_VIEW_V2, parameters: { ...EVENT_VIEW_V2.parameters, base: 'prior_close' } };
  assert.doesNotMatch(splbPage(open, 260).h, /ev-level/);
});

test("a version 2 line's screen-reader label and its no-line sentence name what the line is", () => {
  const label = h => h.match(/<svg class="ew-rel"[^>]*aria-label="([^"]*)"/)?.[1];
  const bench = splbPage(withRel(EVENT_VIEW_V2, 'benchmark'), 260).h;
  assert.match(label(bench), /^相对 SPY，起算价 = 100：最低 100，最高 125$/);
  const self = splbPage(withRel(EVENT_VIEW_V2_RAW, 'self'), 260).h;
  assert.match(label(self), /^自身走势，起算价 = 100：最低 100，最高 125$/);
  // no line kept: the sentence says what it would have been against
  assert.match(splbPage(EVENT_VIEW_V2, 260).h, /<p class="mk-note">视图没有保留这个事件相对 SPY 的走势<\/p>/);
  assert.match(splbPage(EVENT_VIEW_V2_RAW, 260).h, /<p class="mk-note">视图没有保留这个事件的自身走势<\/p>/);
  // version 1's words stay its own
  const route = parseHash(marketHref(EVENT_VIEW_ID, 'WYNN', AT, 'ev-WYNN-2018-01-26'));
  const v1 = withTable(ZH, () => eventHistoryHtml(eventOf(stateAt(route, { [EVENT_VIEW_ID]: { status: 'loaded', view: EVENT_VIEW } }, { 'stock:WYNN@2018-01-26': ready(BARS) }), 'stock:WYNN'), NOW));
  assert.match(label(v1), /^相对大盘，消息前一天 = 100：/);
});
