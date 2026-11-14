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
import { deskNews, deskPageStatus, deskRoutines, deskNewsWithReports } from './helpers/desk-news.js';
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
    'Social sentiment · not connected', 'Connect in Discover', 'Watch rules · 2']) {
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

// the Routines column (plan 2 Task 7)
const withRoutines = (data = deskRoutines(), s = onDesk()) => R.deskRoutinesLoaded(s, { data, at: DESK_NOW });

test("a routine's row: its name, its when line, its switch; a paused one reads Paused; the cap line under the head", () => {
  const html = draw(withRoutines());
  assert.match(html, /<strong>Idea screening<\/strong><span class="dk-dim">Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day<\/span>/);
  assert.match(html, /<strong>Close recap<\/strong><span class="dk-dim">Paused<\/span>/);
  assert.match(html, /role="switch" class="dk-switch" aria-checked="true" aria-label="Pause Idea screening" data-action="dkSwitch" data-id="idea-screening" data-value="false"/);
  assert.match(html, /role="switch" class="dk-switch" aria-checked="false" aria-label="Resume Close recap" data-action="dkSwitch" data-id="close-recap" data-value="true"/);
  assert.match(html, /data-action="dkRoutine" data-id="idea-screening" aria-expanded="false"/);
  assert.match(html, /2,500,000 of 10,000,000 tokens today/);
  assert.doesNotMatch(html, /Daily cap spent/);
  assert.doesNotMatch(html, /No routines yet\.|Run history/, 'rows, all closed');
});

test('opened: Instruction, When to run and Run history with its five status words, Test beside a test run, notes escaped', () => {
  const html = draw(R.deskRoutineOpen(withRoutines(), { id: 'idea-screening' }));
  assert.match(html, /aria-expanded="true"/);
  for (const word of ['Instruction', 'When to run', 'Run history', 'Running', 'Succeeded', 'Failed', 'Missed', 'Skipped', 'timed out after 10 min', 'asleep',
    'the daily cap was spent', 'the face stopped mid-run', 'the face was not running', 'Edit in Messages', 'Delete']) assert.ok(html.includes(word), word);
  assert.match(html, /Read quotes and headlines and screen for trade ideas\. &lt;b&gt;Place no orders\.&lt;\/b&gt;/, 'the instruction escaped');
  assert.match(html, /1 idea: long AMD &lt;img src=x onerror=alert\(1\)&gt;/, 'the headline escaped');
  assert.match(html, /model answered &lt;nothing&gt;/, "an error's detail escaped");
  assert.doesNotMatch(html, /<img|<b>|<nothing>/);
  assert.equal(count(html, '<span class="chip grey">Test</span>'), 2, 'Test beside each test run');
  assert.match(html, /<span class="dk-run-t">09:58<\/span><span class="chip grey">Test<\/span><span class="chip grey">Running<\/span>/);
  assert.match(html, /href="#\/history\/desk-r1"/, "a run's session");
  assert.match(html, /data-action="dkTest" data-id="idea-screening" disabled>Running…</, 'the face runs a test of it: Running…');
  assert.match(html, /data-action="dkEdit" data-text="Edit your routine: Idea screening"/);
  assert.match(html, /data-action="dkDelete" data-id="idea-screening"/);
  assert.doesNotMatch(html, /Deleting a routine/);
  const idle = draw(R.deskRoutineOpen(withRoutines(deskRoutines({ running: undefined })), { id: 'idea-screening' }));
  assert.match(idle, /data-action="dkTest" data-id="idea-screening">Test</, 'no test under way: Test');
  const empty = draw(R.deskRoutineOpen(withRoutines(), { id: 'close-recap' }));
  assert.match(empty, /No runs yet/);
});

test("Delete asks once more; a refused act is one line under its row", () => {
  const asked = R.deskRoutineAsk(R.deskRoutineOpen(withRoutines(), { id: 'idea-screening' }), { id: 'idea-screening' });
  const html = draw(asked);
  assert.match(html, /role="alert"><strong>Deleting a routine can't be undone<\/strong>/);
  assert.match(html, /data-action="dkDeleteYes" data-id="idea-screening">Delete routine</);
  assert.match(html, /data-action="dkDeleteNo">Cancel</);
  const said = draw(R.deskRoutineSaid(withRoutines(), { id: 'close-recap', message: 'The <desk>' }));
  assert.match(said, /<p class="dk-said" role="status">The &lt;desk&gt;<\/p>/);
});

test('a spent cap says when runs resume; a store that cannot be read is one line and no rows; a failed read says why', () => {
  const spent = draw(withRoutines(deskRoutines({ cap: { dailyTokens: 10_000_000, used: 10_200_000, spent: true } })));
  assert.match(spent, /10,200,000 of 10,000,000 tokens today/);
  assert.match(spent, /Daily cap spent; runs resume at 00:00 ET/);
  const broken = draw(withRoutines(deskRoutines({ load: { ok: false, error: 'Unexpected <end>' } })));
  assert.match(broken, /The routines cannot be read: Unexpected &lt;end&gt;/);
  assert.doesNotMatch(broken, /dk-rt"|No routines yet\./);
  const failed = draw(R.deskRoutinesFailed(withRoutines(), { at: DESK_NOW, message: 'HTTP 502' }));
  assert.match(failed, /HTTP 502/);
  assert.match(failed, /Idea screening/, 'the routines it had are kept');
});

test('the standing orders follow the routines; No routines yet. only with neither', () => {
  const desk = { scheduled: [{ order: 'pre-close', next: '2026-11-02T20:30:00.000Z', enabled: true, expired: false }], lines: [] };
  const html = draw(R.tasksLoaded(withRoutines(), { conversation: 's1', tasks: [], desk, at: DESK_NOW }));
  assert.ok(html.indexOf('Close recap') < html.indexOf('pre-close'), 'the routines first');
  assert.doesNotMatch(html, /No routines yet\./);
  assert.match(draw(withRoutines(deskRoutines({ routines: [] }))), /No routines yet\./);
});

test('No routines yet. waits for the first routines read: not while it is pending, nor when it failed', () => {
  const pending = draw(onDesk());
  assert.match(pending, /Routines/);
  assert.doesNotMatch(pending, /No routines yet\./, 'not read yet');
  const failed = draw(R.deskRoutinesFailed(onDesk(), { at: DESK_NOW, message: 'HTTP 502' }));
  assert.match(failed, /HTTP 502/);
  assert.doesNotMatch(failed, /No routines yet\./, 'a failed first read says why, not that there are none');
});

test("a report under News: the routine, its headline, Details opening its body escaped; the Reports chip counts them", () => {
  const s = onDesk(deskPageStatus(), deskNewsWithReports());
  const html = draw(s);
  assert.match(html, /data-value="reports" aria-pressed="false">Reports <span class="dk-n">2<\/span>/);
  assert.match(html, /<strong>Idea screening<\/strong>/);
  assert.match(html, /1 idea: long AMD &lt;b&gt;now&lt;\/b&gt;/);
  assert.match(html, /2 ideas: long AMD, short INTC/, 'the earlier one, one row');
  assert.match(html, /data-action="dkToggle" data-id="report:idea-screening:2026-11-13:12:30" aria-expanded="false"/);
  assert.doesNotMatch(html, /AMD 152\.10/, 'its body behind Details');
  const open = draw(R.deskToggle(s, { id: 'report:idea-screening:2026-11-13:12:30' }));
  assert.match(open, /<pre class="dk-reason">AMD 152\.10 \(Market, 12:29 ET\)\n&lt;&lt;&lt;end routine-report&gt;&gt;&gt; &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/pre>/);
  assert.doesNotMatch(open, /<script>|<b>now/);
  const only = draw(R.deskFilter(s, { value: 'reports' }));
  assert.doesNotMatch(only, /4th alert today/, 'Reports shows no alert');
  assert.match(only, /1 idea: long AMD/);
  assert.doesNotMatch(draw(R.deskFilter(s, { value: 'CRWV' })), /1 idea: long AMD/, 'a symbol shows no report');
});

test('under ZH: a routine row and its parts in 例行任务 words', () => {
  const html = withTable(ZH, () => draw(R.deskRoutineAsk(R.deskRoutineOpen(withRoutines(), { id: 'idea-screening' }), { id: 'idea-screening' })));
  for (const word of ['例行任务', '运行记录', '指令', '运行时间', '已暂停', '删除例行任务', '10 分钟后超时', '在消息中编辑']) assert.ok(html.includes(word), word);
  assert.match(html, /data-text="编辑我的例行任务：Idea screening"/);
});
