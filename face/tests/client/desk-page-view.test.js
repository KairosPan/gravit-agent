// The Desk page's views (desk-page plan 1 Task 4): the head bar's six states from hand-built statuses - a Saturday's closed
// market reads Off hours, never Monitoring; a desk off reads off - News filtered by a symbol with its chip on, an alert's
// move, its row word and its count of the day, a rule's row and a standing order's state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deskHeadOf, newsViewOf, moveOf, rowWordsOf, nthWord, ruleRowOf, routinesViewOf, runNoteOf, reportId } from '../../client/js/host/desk-page-view.js';
import { deskNews, deskPageStatus, deskRoutines, deskNewsWithReports } from './helpers/desk-news.js';
import { deskStatus, DESK_NOW } from './helpers/desk-status.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';

const NOW = new Date(DESK_NOW).toISOString();
const withWatch = patch => { const s = deskPageStatus(); return { ...s, watch: { ...s.watch, ...patch } }; };

test('the head reads null without a status, and off, paused, muted, stopped, monitoring, off hours in that order', () => {
  assert.equal(deskHeadOf(null, NOW), null);
  assert.equal(deskHeadOf({ ok: false, error: 'boom' }, NOW), null);
  assert.deepEqual(deskHeadOf(deskPageStatus({ desk: { enabled: false } }), NOW), { state: 'off', rules: 2 }, 'FACE_DESK=0 is off, whatever the rest says');
  assert.deepEqual(deskHeadOf(deskPageStatus({ off: { setAt: '2026-11-02T14:00:00.000Z', by: 'telegram', until: '2026-11-02T16:00:00.000Z' } }), NOW),
    { state: 'paused', rules: 2, off: { by: 'telegram', since: '09:00 ET', until: '11:00 ET' } });
  assert.deepEqual(deskHeadOf(deskPageStatus({ off: { setAt: '2026-11-02T14:00:00.000Z', by: 'page' } }), NOW).off, { by: 'page', since: '09:00 ET' }, 'a pause with no end');
  assert.deepEqual(deskHeadOf({ ...deskStatus(), watch: { ...deskStatus().watch, rules: [{}] } }, NOW), { state: 'muted', rules: 1, until: '11:00 ET' });
  assert.deepEqual(deskHeadOf(withWatch({ muted: { setAt: '2026-11-02T14:00:00.000Z', by: 'terminal' } }), NOW), { state: 'muted', rules: 2 }, 'muted until a terminal unmutes');
  assert.deepEqual(deskHeadOf(withWatch({ state: 'held-elsewhere' }), NOW), { state: 'stopped', rules: 2, reason: 'held-elsewhere' });
  const { watch: _w, ...noWatch } = deskPageStatus();
  assert.deepEqual(deskHeadOf(noWatch, NOW), { state: 'stopped', rules: 0, reason: 'none' }, 'no watch: stopped, no rules');
  assert.deepEqual(deskHeadOf(deskPageStatus(), NOW), { state: 'monitoring', rules: 2 });
  const saturday = withWatch({ markets: { us: { state: 'closed' }, cn: { state: 'closed' } } });
  assert.deepEqual(deskHeadOf(saturday, '2026-11-14T15:00:00.000Z'), { state: 'offHours', rules: 2 }, 'a Saturday: Off hours, never Monitoring');
  assert.equal(deskHeadOf(withWatch({ markets: { us: { state: 'after-close' } } }), NOW).state, 'offHours');
});

test('News: chips for All and each symbol with counts, the filter narrowing the groups and marking its chip, Details by id', () => {
  const all = newsViewOf(deskNews(), { filter: 'all', open: {}, rules: false });
  assert.deepEqual(all.chips.map(c => [c.id, c.count, c.on]), [['all', 5, true], ['CRWV', 4, false], ['NVDA', 1, false]], 'no Reports chip while there is none');
  assert.deepEqual(all.groups.map(g => [g.symbol, g.open]), [['CRWV', false], ['NVDA', false]]);
  assert.equal(all.date, '2026-11-13');
  assert.equal(all.today, true);
  assert.equal(all.levels, 3);
  assert.equal(all.rulesOpen, false);
  const nvda = newsViewOf(deskNews(), { filter: 'NVDA', open: { 'a-5': true }, rules: true });
  assert.deepEqual(nvda.chips.map(c => [c.id, c.on]), [['all', false], ['CRWV', false], ['NVDA', true]]);
  assert.deepEqual(nvda.groups.map(g => [g.symbol, g.open]), [['NVDA', true]]);
  assert.equal(nvda.rulesOpen, true);
  assert.deepEqual(newsViewOf(deskNews(), { filter: 'AMD' }).chips.find(c => c.on).id, 'all', 'a filter naming no chip reads as All');
  assert.deepEqual(newsViewOf(deskNews(), { filter: 'reports' }).groups.length, 2, 'Reports with none is All');
  const withReports = newsViewOf(deskNews({ reports: { total: 2, groups: [] } }), { filter: 'reports' });
  assert.deepEqual(withReports.chips.map(c => [c.id, c.count, c.on]), [['all', 7, false], ['CRWV', 4, false], ['NVDA', 1, false], ['reports', 2, true]]);
  assert.deepEqual(withReports.groups, [], 'Reports shows no alert');
  assert.equal(newsViewOf(null, {}), null);
});

test("an alert's move, its row word and its count of the day", () => {
  assert.deepEqual(moveOf({ movePct: -8.1 }), { text: '−8.1%', dir: 'down' });
  assert.deepEqual(moveOf({ movePct: 3.25 }), { text: '+3.3%', dir: 'up' });
  assert.equal(moveOf({ movePct: null }), null, 'a level or a filing draws its label');
  assert.deepEqual(moveOf({ movePct: -0.04 }), { text: '0.0%', dir: 'up' }, 'the sign and colour of the rounded value: no minus on 0.0%');
  assert.deepEqual(moveOf({ movePct: -0.05 }), { text: '\u22120.1%', dir: 'down' });
  const [crwv] = deskNews().alerts.groups;
  assert.deepEqual(rowWordsOf(crwv.latest), [], 'sent with its reason: no word');
  assert.deepEqual(rowWordsOf(crwv.earlier[1]), [{ text: 'cooldown', tone: 'held' }]);
  assert.deepEqual(rowWordsOf(crwv.earlier[2]), [{ text: 'Undelivered', tone: 'warn' }, { text: 'no reason', tone: 'warn' }], 'undelivered and unexplained: both words');
  assert.deepEqual(rowWordsOf({ ...crwv.earlier[2], reason: crwv.earlier[0].reason }), [{ text: 'Undelivered', tone: 'warn' }], 'undelivered with its reason: one word');
  assert.deepEqual(rowWordsOf({ delivery: 'queued' }), [{ text: 'no reason', tone: 'warn' }]);
  assert.deepEqual(rowWordsOf({ delivery: 'held' }), [], 'held with no code: no word');
  for (const [held, word] of [['cap', 'cap'], ['muted', 'muted'], ['off', 'paused'], ['window', 'outside its window']]) assert.deepEqual(rowWordsOf({ delivery: 'held', held }), [{ text: word, tone: 'held' }]);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(nthWord), ['1st alert today', '2nd alert today', '3rd alert today', '4th alert today', '11th alert today',
    '12th alert today', '13th alert today', '21st alert today', '22nd alert today']);
});

test('on a day that stands in for today the counts say that day, in both languages', () => {
  assert.deepEqual([1, 2, 3, 4, 11].map(n => nthWord(n, false)), ['1st alert that day', '2nd alert that day', '3rd alert that day', '4th alert that day', '11th alert that day']);
  assert.equal(nthWord(2, true), '2nd alert today');
  const [move] = deskNews().rules;
  assert.equal(ruleRowOf(move, false).today, '4 alerts that day');
  assert.equal(ruleRowOf({ kind: 'gap', pct: 3, symbols: [], alertsToday: 1 }, false).today, '1 alert that day');
  assert.equal(ruleRowOf(move, true).today, '4 alerts today');
  withTable(ZH, () => {
    assert.equal(nthWord(2, false), '当天第 2 条提醒');
    assert.equal(ruleRowOf(move, false).today, '当天 4 条提醒');
    assert.equal(nthWord(2), '今天第 2 条提醒');
  });
});

test("a rule's row", () => {
  const [move, filing] = deskNews().rules;
  assert.deepEqual(ruleRowOf(move), { names: 'CRWV', what: '±8% move', today: '4 alerts today' });
  assert.deepEqual(ruleRowOf(filing), { names: 'Holdings', what: 'Filings 8-K, 4', today: '0 alerts today' });
  assert.deepEqual(ruleRowOf({ kind: 'gap', pct: 3, symbols: [], alertsToday: 1 }), { names: 'No symbols', what: '±3% gap', today: '1 alert today' });
});

// the Routines column (plan 2 Task 7)
test("a run's note: a succeeded run's headline as it came, each code's words, an error's detail, none while it runs", () => {
  assert.equal(runNoteOf({ status: 'succeeded', note: '1 idea: long AMD <b>' }), '1 idea: long AMD <b>', 'the headline is content');
  assert.equal(runNoteOf({ status: 'succeeded', note: 'late' }), 'late', "a headline that reads like a code is the model's words");
  assert.equal(runNoteOf({ status: 'running', note: '' }), '');
  for (const [status, note, words] of [['failed', 'timed-out', 'timed out after 10 min'], ['failed', 'no-answer', 'no answer'], ['missed', 'asleep', 'asleep'],
    ['missed', 'down', 'the face was not running'], ['missed', 'late', 'found late'], ['missed', 'busy', 'another run was going'],
    ['skipped', 'paused', 'the desk was paused'], ['skipped', 'cap', 'the daily cap was spent'], ['failed', 'interrupted', 'the face stopped mid-run'],
    ['failed', 'cancelled', 'cancelled'], ['failed', 'error', 'error'], ['failed', 'something-new', 'something-new']]) {
    assert.equal(runNoteOf({ status, note }), words, note);
  }
  assert.equal(runNoteOf({ status: 'failed', note: 'error', detail: 'model said <no>' }), 'model said <no>', "an error's detail as it came");
});

test('the routines: rows with their when line or Paused, the opened one with its runs worded, busy and said; the cap line', () => {
  assert.equal(routinesViewOf(null, {}, NOW), null);
  const view = routinesViewOf(deskRoutines(), { rOpen: 'idea-screening', rAsk: 'idea-screening', rBusy: {}, rSaid: { 'close-recap': 'nope' } }, NOW);
  assert.equal(view.error, null);
  assert.deepEqual(view.cap, { line: '2,500,000 of 10,000,000 tokens today', spent: false });
  const [idea, close] = view.rows;
  assert.deepEqual([idea.name, idea.when, idea.on, idea.open, idea.asking, idea.busy], ['Idea screening', 'Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day', true, true, true, true],
    'busy: the face runs a test of it');
  assert.equal(idea.schedule, idea.when);
  assert.match(idea.instruction, /<b>Place no orders\.<\/b>/, 'passed as it came, for the renderer to escape');
  assert.deepEqual(idea.runs.map(u => [u.time, u.status, u.tone, u.note, u.test]), [
    ['09:58', 'Running', 'grey', '', true],
    ['09:30', 'Succeeded', 'ok', '1 idea: long AMD <img src=x onerror=alert(1)>', false],
    ['09:00', 'Failed', 'down', 'timed out after 10 min', false],
    ['08:45', 'Failed', 'down', 'model answered <nothing>', true],
    ['08:40', 'Failed', 'down', 'error', false],
    ['08:30', 'Missed', 'warn', 'asleep', false],
    ['08:00', 'Skipped', 'grey', 'the daily cap was spent', false],
    ['07:30', 'Failed', 'down', 'the face stopped mid-run', false],
    ['2026-10-30 15:30', 'Missed', 'warn', 'the face was not running', false],
  ]);
  assert.equal(idea.runs[1].sessionId, 'desk-r1');
  assert.equal(idea.runs[0].sessionId, undefined);
  assert.deepEqual([close.when, close.on, close.open, close.busy, close.said, close.runs], ['Paused', false, false, false, 'nope', undefined], 'a closed row carries no parts');
  const asked = routinesViewOf(deskRoutines({ running: undefined }), { rOpen: '', rBusy: { 'close-recap': 'test' } }, NOW);
  assert.equal(asked.rows[0].busy, false, 'no test under way');
  assert.equal(asked.rows[1].busy, true, 'a Test asked here');
  assert.equal(asked.rows[0].asking, false);
  assert.equal(routinesViewOf(deskRoutines({ cap: { dailyTokens: 10_000_000, used: 10_200_000, spent: true } }), {}, NOW).cap.spent, true);
});

test('a store that cannot be read is its error and no rows', () => {
  const view = routinesViewOf(deskRoutines({ load: { ok: false, error: 'routines.json: Unexpected end of JSON input' } }), {}, NOW);
  assert.deepEqual(view.rows, []);
  assert.equal(view.error, 'routines.json: Unexpected end of JSON input');
});

test("News' reports: under All and Reports, each group's latest open by its id; none under a symbol", () => {
  const all = newsViewOf(deskNewsWithReports(), { filter: 'all', open: { [reportId({ key: 'idea-screening:2026-11-13:12:30' })]: true } });
  assert.deepEqual(all.chips.map(c => [c.id, c.count]), [['all', 7], ['CRWV', 4], ['NVDA', 1], ['reports', 2]]);
  assert.deepEqual(all.reports.map(g => [g.name, g.latest.headline, g.earlier.length, g.open]), [['Idea screening', '1 idea: long AMD <b>now</b>', 1, true]]);
  assert.equal(reportId({ key: 'k' }), 'report:k');
  const reports = newsViewOf(deskNewsWithReports(), { filter: 'reports' });
  assert.deepEqual([reports.groups.length, reports.reports.length, reports.reports[0].open], [0, 1, false]);
  assert.deepEqual(newsViewOf(deskNewsWithReports(), { filter: 'CRWV' }).reports, []);
});
