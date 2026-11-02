// The Desk view inside Markets (plan 2026-11-01-desk-p3-watch Task 11, ruling 15): /data/desk/status as the tab draws it —
// the server's status phrases re-spelt here, in New York's time — and a level's mark on its market row and page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DESK_TAB, DESK_POLL_MS, deskViewOf, markOf } from '../../client/js/host/desk-view.js';
import { deskStatus, DESK_NOW } from './helpers/desk-status.js';

const STATUS = deskStatus();
const NOW_ISO = new Date(DESK_NOW).toISOString();

test('the tab and the poll', () => {
  assert.equal(DESK_TAB, 'desk');
  assert.equal(DESK_POLL_MS, 10_000);
});

test('deskViewOf renders the head, both markets with their own today, the alerts with their latency, the levels, standing orders, firings, runs, sleep gaps and the refused files in ET', () => {
  const v = deskViewOf(STATUS, NOW_ISO);
  assert.equal(v.head, 'up 3h 5m since 2026-11-02T11:55:00.000Z · desk on');
  assert.equal(v.watch, 'watch: watching');
  assert.equal(v.off, undefined);
  assert.equal(v.telegram, 'telegram: not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_ID in $DSH_HOME/.env)');
  assert.equal(v.budget, 'budget: 1,234,567 of 2,000,000 tokens today');
  assert.deepEqual(v.markets, [
    { name: 'US', line: 'watch US: polling the 2026-11-02 session, 2 symbols, last poll 09:59 ET', today: 'alerts today (US): 1 sent, 1 suppressed (cap 1)' },
    { name: 'A shares', line: 'watch A shares: the 2026-11-02 session has closed', today: 'alerts today (A shares): 1 sent, 1 suppressed (muted 1)' },
  ]);
  assert.equal(v.pending, null);
  assert.equal(v.muted, 'alerts: muted until 11:00 ET (npm run desk -- unmute)');
  assert.equal(v.ledger, null);
  assert.equal(v.filings, 'filings: off: set ALPHA_EDGAR_USER_AGENT');
  // newest first; an alert on another New York date is dated; a queued send, and one never sent, has no latency
  assert.deepEqual(v.alerts, [
    { when: '09:58', what: 'NVDA stop · 169.8 ROBINHOOD', outcome: 'sent', latency: '1.8 s' },
    { when: '09:50', what: 'AMD move-3 · 151.2 NASDAQ', outcome: 'queued', latency: '—' },
    { when: '09:40', what: 'AMD move-3 · gap · 150.1 NASDAQ', outcome: 'suppressed (cap)', latency: '—' },
    { when: '2026-11-01 21:15', what: '600519 buy_zone · 1610 TENCENT', outcome: 'sent', latency: '2.4 s' },
    { when: '2026-11-01 21:10', what: '600519 move-2', outcome: 'suppressed (muted)', latency: '—' },
  ]);
  assert.deepEqual(v.levels, [
    { market: 'US', symbol: 'NVDA', label: 'stop 170 · -1.30%', plan: 'sell half on a close below 170', file: 'desk/levels.yml' },
    { market: 'A shares', symbol: '600519', label: 'buy_zone 1600-1650', plan: 'add 100 shares in the zone', file: 'desk/levels.yml' },
  ]);
  assert.deepEqual(v.standing, [{ id: 'brief', anchor: '09:20', next: 'next 2026-11-03 09:20 ET', hash: 'ok', last: 'last finished 09:31 ET' }]);
  assert.deepEqual(v.standingNotes, []);
  assert.deepEqual(v.firings, [{ order: 'brief', when: '09:31', kind: 'finished', outcome: 'finished' }]);
  // newest first
  assert.deepEqual(v.runs, [{ bootedAt: '06:55', pid: 4242, lost: false }, { bootedAt: '2026-11-01 07:00', pid: 4000, lost: true }]);
  assert.deepEqual(v.asleep, [{ from: '08:00', to: '08:20', gap: '20 min' }]);
  // only the files with a refusal or an error; a missing one is no fault
  assert.deepEqual(v.files, [{ file: 'desk/levels.yml', note: '1 of 3 refused: #3 TSLA: price must be a positive number' }]);
});

test('deskViewOf: a pause, a watch held elsewhere, a market off, held alerts, a refused file, the ledgers unreadable, standing refused; ten runs at most', () => {
  const s = deskStatus();
  s.off = { setAt: '2026-11-02T14:00:00.000Z', by: 'page', until: '2026-11-03T15:00:00.000Z' };
  s.ledgerError = 'EACCES';
  s.budget = { ...s.budget, error: 'EACCES' };
  s.desk.enabled = false;
  s.runs = Array.from({ length: 12 }, (_, i) => ({ bootedAt: new Date(DESK_NOW - (12 - i) * 3_600_000).toISOString(), pid: 100 + i, lost: false }));
  s.standing = { ...s.standing, file: { path: 'x', state: 'refused', errors: ['#1: unknown key on', '#2: at must be HH:MM'] }, calendar: { clock: 'XNYS', state: 'failed', error: 'ETIMEDOUT' }, orders: [] };
  s.watch = {
    ...s.watch, state: 'held-elsewhere', holder: { pid: 77, since: '2026-11-02T10:00:00.000Z' }, pending: 3, ledgerError: 'EIO', muted: { setAt: '2026-11-02T14:00:00.000Z', by: 'terminal' },
    markets: { ...s.watch.markets, cn: { ...s.watch.markets.cn, state: 'off', today: { sent: 0, suppressed: { cooldown: 0, cap: 0, muted: 0, off: 0, window: 0 }, repeats: 0 } } },
    files: [{ file: 'desk/rules.yml', kind: 'rules', entries: 1, refusals: [], error: 'not YAML: bad indentation of a mapping entry' }],
    filings: { state: 'polling', symbols: 4, aShares: 0, seeded: 4, lastPollAt: '2026-11-02T14:55:00.000Z', lastError: 'HTTP 503' },
  };
  const v = deskViewOf(s, NOW_ISO);
  assert.equal(v.head, 'up 3h 5m since 2026-11-02T11:55:00.000Z · desk off (FACE_DESK=0)');
  assert.equal(v.off, 'desk: paused since 09:00 ET by page until 2026-11-03 10:00 ET (npm run desk -- resume)');
  assert.equal(v.watch, 'watch: another face (pid 77) holds the watch on this home');
  assert.deepEqual(v.markets.map(m => m.name), ['US'], 'a market off has no line and, with nothing today, no counts');
  assert.equal(v.pending, "alerts: 3 held for the next hour's batch");
  assert.equal(v.muted, 'alerts: muted until a terminal lifts it (npm run desk -- unmute)');
  assert.equal(v.ledger, 'alerts: the ledger cannot be read (EIO), so the watch sends nothing until it can');
  assert.equal(v.ledgerError, 'ledger unreadable: EACCES');
  assert.equal(v.budget, 'budget: 1,234,567 of 2,000,000 tokens today (ledger unreadable: EACCES)');
  assert.equal(v.filings, 'filings: polling, 4 symbols, last poll 09:55 ET; last error HTTP 503');
  assert.deepEqual(v.files, [{ file: 'desk/rules.yml', note: 'refused, the last good load kept: not YAML: bad indentation of a mapping entry' }]);
  assert.deepEqual(v.standingNotes, [
    'standing orders stopped: standing.yml is refused: #1: unknown key on; #2: at must be HH:MM',
    'standing orders: no calendar today, XNYS: ETIMEDOUT',
  ]);
  assert.equal(v.runs.length, 10);
  assert.equal(v.runs[0].pid, 111, 'the newest first');
  // no watch, no standing, no budget, no Telegram: their parts are empty, never invented
  const bare = deskViewOf({ ok: true, pid: 1, bootedAt: '2026-11-02T14:00:00.000Z', uptimeMs: 60_000, desk: { enabled: true, dir: 'd' }, asleep: [], runs: [], turnsToday: { count: 0, usage: {} } }, NOW_ISO);
  assert.deepEqual([bare.watch, bare.telegram, bare.budget, bare.filings, bare.markets, bare.alerts, bare.levels, bare.standing, bare.firings], [null, null, null, null, [], [], [], [], []]);
  assert.equal(deskViewOf({ ok: false }, NOW_ISO), null);
  assert.equal(deskViewOf(null, NOW_ISO), null);
});

test('markOf matches stock:NVDA and cn:600519 to their marks and nothing else', () => {
  assert.deepEqual(markOf(STATUS, 'stock:NVDA'), { label: 'stop 170 · -1.30%', plan: 'sell half on a close below 170', file: 'desk/levels.yml' });
  assert.deepEqual(markOf(STATUS, 'cn:600519'), { label: 'buy_zone 1600-1650', plan: 'add 100 shares in the zone', file: 'desk/levels.yml' });
  assert.equal(markOf(STATUS, 'coin:BTC'), null);
  assert.equal(markOf(STATUS, 'rwa:NVDA'), null, 'a tokenized NVDA is not the share');
  assert.equal(markOf(STATUS, 'stock:600519'), null);
  assert.equal(markOf({ ok: true }, 'stock:NVDA'), null);
  assert.equal(markOf(null, 'stock:NVDA'), null);
  // a level above the last print reads +; the nearest mark of a symbol is its first
  const s = deskStatus();
  s.watch.marks.unshift({ market: 'us', symbol: 'NVDA', kind: 'target', level: '180', when: 'cross_up', plan: 'trim', file: 'desk/levels.yml', distancePct: 0.85 });
  assert.equal(markOf(s, 'stock:NVDA').label, 'target 180 · +0.85%');
});
