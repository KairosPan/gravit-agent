// The Desk screen drawn (desk-page plan 1 Task 4) over states built with the real reducers: the head bar and its chip, the
// paused banner, the desk off and the status unread with no columns, News - its sources, Calendar's line, the filter chips,
// each group's latest alert and its earlier rows with their words, a reason's markup escaped, Details opened, an empty day
// and an earlier day's date, the rules fold - and the Routines column with a standing order's read-only row; and the words
// under ZH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderDeskScreen } from '../../client/js/render/desk-page.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { deskNews, deskPageStatus } from './helpers/desk-news.js';
import { DESK_NOW } from './helpers/desk-status.js';

const onDesk = (status = deskPageStatus(), news = deskNews()) => {
  let s = R.nav(emptyState(), { screen: 'desk', id: null });
  if (status) s = R.deskLoaded(s, { data: status, at: DESK_NOW });
  if (news) s = R.deskNewsLoaded(s, { data: news, at: DESK_NOW });
  return s;
};
const draw = s => renderDeskScreen(s, DESK_NOW);
const count = (html, needle) => html.split(needle).length - 1;

test('monitoring: the head, News and Routines with their words', () => {
  const html = draw(onDesk());
  for (const word of ['Desk', 'Monitoring', 'US equities 04:00–20:00 ET · 2 watch rules', 'News', "What moved and what's next", 'Routines', 'Run on a schedule or a trigger',
    'Calendar', 'No economic calendar or earnings source connected.', 'Quotes', 'Headlines · Nasdaq answered 503', 'Fund flows · not connected',
    'Social sentiment · not connected', 'Connect in Discover', 'Watch rules · 2', 'No routines yet.']) {
    assert.ok(html.includes(word), word);
  }
  assert.match(html, /data-action="deskPause"/, 'the Pause key');
  assert.match(html, /class="dk-cols"/);
  assert.match(html, /href="#\/discover"/);
  assert.match(html, /Routines are created in <a href="#\/messages">Messages<\/a>: tell Gravit what you want done and when, and it replies with a card\. Confirm the card and the routine appears here\./);
  assert.doesNotMatch(html, /Reports/, 'Reports draws nothing while there is none');
});

test("a group's latest alert, its count of the day, its headline and earlier rows; the reason's markup escaped", () => {
  const html = draw(onDesk());
  assert.match(html, /CRWV/);
  assert.match(html, /−8\.1%/);
  assert.match(html, /4th alert today/);
  assert.match(html, /12:46 ET/);
  assert.match(html, /CRWV AI-compute names sell off &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; again/, 'the headline drawn as text');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /13 sources read/);
  assert.match(html, /Earlier today/);
  assert.match(html, /−8\.5%/);
  assert.match(html, /cooldown/);
  assert.equal(count(html, 'Undelivered'), 1, 'Undelivered on the undelivered row alone');
  assert.match(html, /stop 170/, "a level's alert draws its label");
  assert.equal(count(html, 'no reason'), 2, 'no reason on the queued level alert and the undelivered row');
  assert.match(html, /<span class="dk-word warn">Undelivered<\/span><span class="dk-word warn">no reason<\/span><\/div>/, 'the undelivered row carries both words');
  assert.match(html, /data-action="dkFilter" data-value="CRWV"/);
  assert.match(html, /data-action="dkToggle" data-id="a-4" aria-expanded="false"/);
  assert.doesNotMatch(html, /dk-reason/, 'Details closed');
});

test('Details opens the reason as written, escaped, with the link to its session; Hide closes it', () => {
  const open = R.deskToggle(onDesk(), { id: 'a-4' });
  const html = draw(open);
  assert.match(html, /aria-expanded="true"[^>]*>Hide</);
  assert.match(html, /<pre class="dk-reason">CRWV 52\.10, &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; peers\nNo company announcement today\.<\/pre>/);
  assert.match(html, /href="#\/history\/desk-s9"/);
  assert.doesNotMatch(draw(R.deskToggle(open, { id: 'a-4' })), /dk-reason/);
});

test('the filter narrows News to one symbol; the rules fold opens to its rows and the levels', () => {
  const html = draw(R.deskFilter(onDesk(), { value: 'NVDA' }));
  assert.match(html, /data-value="NVDA" aria-pressed="true"/);
  assert.doesNotMatch(html, /4th alert today/);
  const rules = draw(R.deskRules(onDesk()));
  assert.match(rules, /data-action="dkRules" aria-expanded="true"/);
  assert.match(rules, /±8% move/);
  assert.match(rules, /4 alerts today/);
  assert.match(rules, /Price levels · 3/);
});

test('an empty day reads No alerts today.; an earlier day stands under its date', () => {
  assert.match(draw(onDesk(deskPageStatus(), deskNews({ alerts: { total: 0, groups: [] } }))), /No alerts today\./);
  const friday = draw(onDesk(deskPageStatus(), deskNews({ today: false })));
  assert.match(friday, /2026-11-13/);
  assert.doesNotMatch(friday, /Earlier today/);
});

test('paused: the chip and the banner, no Pause key; muted: its time; stopped: the watch line; off hours', () => {
  const paused = draw(onDesk(deskPageStatus({ off: { setAt: '2026-11-02T14:00:00.000Z', by: 'telegram' } })));
  assert.match(paused, /Paused/);
  assert.match(paused, /Desk paused/);
  assert.match(paused, /Resume from a terminal: npm run desk -- resume/);
  assert.match(paused, /telegram/);
  assert.doesNotMatch(paused, /data-action="deskPause"/);
  const s = deskPageStatus();
  assert.match(draw(onDesk({ ...s, watch: { ...s.watch, muted: { setAt: '2026-11-02T14:00:00.000Z', by: 'telegram', until: '2026-11-02T16:00:00.000Z' } } })), /Muted until 11:00 ET/);
  const stopped = draw(onDesk({ ...s, watch: { ...s.watch, state: 'held-elsewhere' } }));
  assert.match(stopped, /Watch stopped/);
  assert.match(stopped, /another face holds the watch/);
  const closed = draw(onDesk({ ...s, watch: { ...s.watch, markets: { us: { state: 'closed' } } } }));
  assert.match(closed, /Off hours/);
  assert.doesNotMatch(closed, /Monitoring/);
});

test('the desk off, a status not read yet and one that failed, with or without one kept: one line, no columns, no Monitoring', () => {
  const off = draw(onDesk(deskPageStatus({ desk: { enabled: false } })));
  assert.match(off, /Desk is off \(FACE_DESK=0\)/);
  assert.doesNotMatch(off, /dk-cols|Monitoring|deskPause/);
  const loading = draw(onDesk(null));
  assert.match(loading, /Loading…/);
  assert.doesNotMatch(loading, /dk-cols|Monitoring/);
  const failed = draw(R.deskFailed(onDesk(null), { at: DESK_NOW, message: 'HTTP 502' }));
  assert.match(failed, /HTTP 502/);
  assert.match(failed, /Desk status unavailable/);
  assert.doesNotMatch(failed, /dk-cols|Monitoring/);
  const stale = draw(R.deskFailed(onDesk(), { at: DESK_NOW, message: 'HTTP 502' }));
  assert.match(stale, /HTTP 502/);
  assert.doesNotMatch(stale, /dk-cols|Monitoring|deskPause/, 'a failed read over a status kept: no stale Monitoring');
  assert.match(draw(R.deskLoading(onDesk())), /Monitoring/, 'a read on its way keeps the screen');
  const news = draw(onDesk(deskPageStatus(), null));
  assert.match(news, /dk-cols/, 'the status read, the news not yet: the columns');
  assert.match(news, /Loading…/);
});

test('the standing orders: read-only rows with their next firing or their state and the Terminal chip', () => {
  const desk = { scheduled: [{ order: 'pre-close', next: '2026-11-02T20:30:00.000Z', enabled: true, expired: false }, { order: 'report-q3', enabled: true, expired: true }], lines: [] };
  const html = draw(R.tasksLoaded(onDesk(), { conversation: 's1', tasks: [], desk, at: DESK_NOW }));
  assert.match(html, /pre-close/);
  assert.match(html, /Next 15:30 ET/);
  assert.match(html, /report-q3/);
  assert.match(html, /Expired/);
  assert.equal(count(html, '>Terminal<'), 2);
  assert.doesNotMatch(html, /No routines yet\./);
});

test('under ZH: the title 值守台, 资讯 and 例行任务', () => {
  const html = withTable(ZH, () => draw(onDesk()));
  assert.match(html, /值守台/);
  assert.match(html, /资讯/);
  assert.match(html, /例行任务/);
});

test('an earlier row whose reason has an empty headline draws no headline element; a held row with no code no word', () => {
  const news = deskNews();
  const [crwv] = news.alerts.groups;
  const blank = { ...crwv.earlier[0], reason: { ...crwv.earlier[0].reason, headline: '' } };
  const bare = { ...crwv.earlier[1], held: undefined };
  const html = draw(onDesk(deskPageStatus(), { ...news, alerts: { ...news.alerts, groups: [{ ...crwv, earlier: [blank, bare] }, news.alerts.groups[1]] } }));
  assert.match(html, /<div class="dk-early"><span class="dk-time">12:12<\/span><span class="dk-move down">\u22128\.5%<\/span><\/div>/, 'time and move, no empty note');
  assert.match(html, /<div class="dk-early"><span class="dk-time">09:52<\/span><span class="dk-move down">\u22128\.2%<\/span><\/div>/, 'held with no code: no word span');
  assert.doesNotMatch(html, /dk-note"><\/span>|dk-word[^"]*"><\/span>/);
});
