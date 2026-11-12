// The event table drawn (render/event-table.js): a card per event analog view — its head with the counts and the
// against-the-market line, the present case first, each group in order, a measured row's labelled chips and its market link,
// an unmeasured row muted with the market's words — and the caveats under it; a view no longer kept is one line alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventTableHtml } from '../../client/js/render/event-table.js';
import { marketHref } from '../../client/js/host/event-table.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { EVENT_VIEW, EVENT_VIEW_ID } from './helpers/event-view.js';

const loaded = view => ({ status: 'loaded', view });
const draw = (entry, id = EVENT_VIEW_ID) => withTable(ZH, () => eventTableHtml(entry, id));
// the row of a case: from its label to the next row (or the group's end)
const ROW = /<div class="et-row(?: unmeasured)?">/g;
const rowOf = (h, label) => {
  const at = h.indexOf(label);
  assert.ok(at > 0, `drawn: ${label}`);
  const starts = [...h.matchAll(ROW)].map(m => m.index);
  const start = starts.filter(i => i < at).at(-1);
  const end = Math.min(...[starts.find(i => i > at), h.indexOf('<div class="et-group">', at), h.indexOf('</section>', at)].filter(i => i !== undefined && i >= 0));
  return h.slice(start, end);
};

test('a loaded view draws its head: the title, the counts and the against-the-market line', () => {
  const h = draw(loaded(EVENT_VIEW));
  assert.match(h, /<div class="et-title">CEO 风波：创始人\/职业经理人 × 被查在任\/当天离任<\/div>/);
  assert.match(h, /<div class="et-counts">6 个事件，量到 4 个，2 个量不到<\/div>/);
  assert.match(h, /<div class="et-basis">[^<]*SPY[^<]*当天[^<]*<\/div>/);
});

test('the present case first, then the groups in order, 不足 8 例 under a group with no summary', () => {
  const h = draw(loaded(EVENT_VIEW));
  const present = h.indexOf('本次 · NVDA');
  const a = h.indexOf('A 创始人/被查·在任');
  const c = h.indexOf('C 经理人/被查·在任');
  assert.ok(present > 0 && present < a && a < c, 'present, A, C');
  assert.ok(present < h.indexOf('董事会宣布独立调查') && h.indexOf('股东集体诉讼') < a, "the anchors under the present case");
  assert.equal(h.match(/不足 8 例，不给中位数，只看个案/g)?.length, 2, 'both groups have no summary');
  assert.match(h, /3 例 · 量到 2 例/);
  // a group with a summary shows its medians, labelled, in place of the sentence
  const named = EVENT_VIEW.groups.named.map((g, i) => (i === 0 ? { ...g, summary: { ...g.summary, x0: -0.05, x60: 0.031 } } : g));
  const s = draw(loaded({ ...EVENT_VIEW, groups: { ...EVENT_VIEW.groups, named } }));
  assert.equal(s.match(/不足 8 例/g)?.length, 1);
  assert.match(s, /<div class="et-median"><span class="et-median-label">中位数<\/span><span class="et-chip down"><span class="et-chip-label">当天<\/span>−5\.0%<\/span><span class="et-chip up"><span class="et-chip-label">60 天<\/span>\+3\.1%<\/span><\/div>/);
});

test("a measured row: its date and timing, its badge, its note, its three labelled chips and its 行情 › link", () => {
  const h = draw(loaded(EVENT_VIEW));
  const wynn = rowOf(h, 'Wynn Resorts · Steve Wynn');
  assert.match(wynn, /<span class="et-label">Wynn Resorts · Steve Wynn<\/span>/);
  assert.match(wynn, /<span class="et-date">2018-01-26<\/span><span class="et-timing">盘中<\/span>/);
  assert.match(wynn, /<span class="et-badge ok">已核实<\/span>/);
  assert.match(wynn, /<div class="et-note">WSJ 性行为不端报道，盘中；当日仍为董事长兼 CEO<\/div>/);
  const chips = [...wynn.matchAll(/<span class="et-chip (\w+)"><span class="et-chip-label">([^<]+)<\/span>([^<]+)<\/span>/g)].map(m => m.slice(1).join(' '));
  assert.deepEqual(chips, ['down 当天 −11.2%', 'down 5 天 −14.6%', 'up 60 天 +2.0%']);
  assert.ok(wynn.includes(`<a class="et-market" href="${marketHref(EVENT_VIEW_ID, 'WYNN', '2018-01-26', 'ev-WYNN-2018-01-26').replaceAll('&', '&amp;')}">行情 ›</a>`));
  assert.doesNotMatch(wynn, /et-shift/, 'not shifted');
  // JD: its day 0 shifted, and its flag as a small word
  const jd = rowOf(h, 'JD.com · Richard Liu');
  assert.match(jd, /<span class="et-timing">休市日<\/span><span class="et-shift">→ 按 09-04 算<\/span>/);
  assert.match(jd, /<span class="et-flag">[^<]+<\/span>/);
  // INFY: measured, its date unverified
  assert.match(rowOf(h, 'Infosys · Salil Parekh'), /<span class="et-badge warn">日期未核实<\/span>/);
  // the present case's anchors: four chips, none written as 尚无 when absent; the one with no source unverified and no link
  const q1 = rowOf(h, '董事会宣布独立调查');
  assert.deepEqual([...q1.matchAll(/<span class="et-chip-label">([^<]+)<\/span>([^<]+)</g)].map(m => `${m[1]} ${m[2]}`), ['当天 −6.5%', '次日 −11.3%', '5 天 尚无', '60 天 尚无']);
  assert.match(q1, /<span class="et-chip none">/);
  const q2 = rowOf(h, '股东集体诉讼');
  assert.match(q2, /<span class="et-badge warn">未核实<\/span>/);
  assert.doesNotMatch(q2, /et-src/, 'no source, no source link');
});

test('an unmeasured row is muted with the market\'s words and no 行情 ›; its source link kept, new tab, no referrer', () => {
  const h = draw(loaded(EVENT_VIEW));
  const chk = rowOf(h, 'Chesapeake · Aubrey McClendon');
  assert.match(chk, /^<div class="et-row unmeasured">/);
  assert.match(chk, /<div class="et-words">Nasdaq keeps no daily bars of CHK<\/div>/);
  assert.doesNotMatch(chk, /et-chip|et-market|行情/);
  assert.match(chk, /<a class="et-src" href="https:\/\/www\.oklahoman\.com\/[^"]+" target="_blank" rel="noopener noreferrer">来源 ↗<\/a>/);
  for (const m of h.matchAll(/<a class="et-src"[^>]*>/g)) assert.match(m[0], /target="_blank" rel="noopener noreferrer"/);
});

test('every text from the view is escaped, and masked as a worker\'s words', () => {
  const cases = EVENT_VIEW.cases.map((c, i) => (i === 0 ? { ...c, label: '<img src=x onerror=alert(1)>', note: 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' } : c));
  const h = draw(loaded({ ...EVENT_VIEW, title: 'a <b>title</b>', cases }));
  assert.doesNotMatch(h, /<img|<b>/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /a &lt;b&gt;title&lt;\/b&gt;/);
  assert.doesNotMatch(h, /abcdefghijklmnopqrstuvwxyz0123456789/, 'the key masked');
});

test('the caveats are always under the card', () => {
  const h = draw(loaded(EVENT_VIEW));
  assert.match(h, /<\/div><div class="et-caveats">[^<]*不是交易依据[^<]*<\/div><\/section>$/);
  const empty = draw(loaded({ kind: 'events', title: 'Nothing found' }));
  assert.match(empty, /<div class="et-caveats">/);
});

test('loading says so; failed draws its words; a view no longer kept is one line and nothing else (Review Focus 1)', () => {
  assert.match(draw({ status: 'loading' }), /^<div class="et-state">[^<]+<\/div>$/);
  assert.match(draw(undefined), /^<div class="et-state">[^<]+<\/div>$/, 'not asked yet reads as loading');
  assert.equal(draw({ status: 'failed', error: 'HTTP 500', gone: false }), '<div class="et-state et-failed">HTTP 500</div>');
  const gone = draw({ status: 'failed', error: 'HTTP 404', gone: true });
  assert.equal(gone, '<div class="et-state">这张对标表已不再保留</div>');
  assert.doesNotMatch(gone, /HTTP|et-caveats|et-failed/);
});
