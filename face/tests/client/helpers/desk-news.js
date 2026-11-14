// A DeskNews as GET /data/desk/news answers it (src/desk-news.ts), shaped like the Task 2 tests: New York's 13 November,
// CRWV's four alerts - the latest sent with a reason carrying markup from a web page, then one sent with its reason, one
// held back by the cooldown and one undelivered with none - and NVDA's stop level queued with no reason; Quotes ok,
// Headlines unavailable, Filings off; two rules and three levels. And the desk's status the Desk page reads beside it
// (desk-status.js's, monitoring: no mute, its two rules listed).
import { deskStatus } from './desk-status.js';

const reason = (headline, over = {}) => ({ headline, label: 'Media read · no company announcement', text: headline, pages: 13, sessionId: 'desk-s9', outcome: 'ended', ...over });

export function deskNews(over = {}) {
  return {
    ok: true, date: '2026-11-13', today: true,
    sources: [{ id: 'quotes', state: 'ok' }, { id: 'headlines', state: 'unavailable', reason: 'Nasdaq answered 503' }, { id: 'filings', state: 'off' }],
    alerts: {
      total: 5,
      groups: [
        {
          symbol: 'CRWV', count: 4,
          latest: {
            id: 'a-4', t: '2026-11-13T17:46:21.000Z', symbol: 'CRWV', market: 'us', label: 'move-8', kind: 'move', movePct: -8.1, nth: 4, delivery: 'sent',
            reason: reason('CRWV AI-compute names sell off <script>alert(1)</script> & again', { text: 'CRWV 52.10, <script>alert(1)</script> & peers\nNo company announcement today.' }),
          },
          earlier: [
            { id: 'a-3', t: '2026-11-13T17:12:00.000Z', symbol: 'CRWV', market: 'us', label: 'move-8', kind: 'move', movePct: -8.5, nth: 3, delivery: 'sent', reason: reason('CRWV AI and neocloud names sold again') },
            { id: 'a-2', t: '2026-11-13T14:52:00.000Z', symbol: 'CRWV', market: 'us', label: 'move-8', kind: 'move', movePct: -8.2, nth: 2, delivery: 'held', held: 'cooldown' },
            { id: 'a-1', t: '2026-11-13T09:02:00.000Z', symbol: 'CRWV', market: 'us', label: 'move-8', kind: 'gap', movePct: -8.8, nth: 1, delivery: 'undelivered' },
          ],
        },
        {
          symbol: 'NVDA', count: 1,
          latest: { id: 'a-5', t: '2026-11-13T15:10:00.000Z', symbol: 'NVDA', market: 'us', label: 'stop 170', kind: 'level', movePct: null, nth: 1, delivery: 'queued' },
          earlier: [],
        },
      ],
    },
    reports: { total: 0, groups: [] },
    rules: [
      { id: 'crwv-8', kind: 'move_pct', pct: 8, symbols: ['CRWV'], holdings: false, levels: false, alertsToday: 4 },
      { id: 'filings', kind: 'filing', forms: ['8-K', '4'], symbols: [], holdings: true, levels: false, alertsToday: 0 },
    ],
    levels: 3,
    ...over,
  };
}

// the desk's status on the Desk page: monitoring US shares, no mute, desk/rules.yml's two rules
export function deskPageStatus(over = {}) {
  const s = deskStatus();
  const { muted: _muted, ...watch } = s.watch;
  return { ...s, watch: { ...watch, rules: [{ id: 'crwv-8' }, { id: 'filings' }] }, ...over };
}

// A RoutinesStatus as GET /data/desk/routines answers it (src/routine-clock.ts), read at DESK_NOW (New York's 2 November,
// 10:00): Idea screening on, a test of it running, then its history of each status and note - a headline carrying markup,
// a time-out with its session, an error with its detail, an error with none, asleep, the cap, the face stopped mid-run, and
// one of the day before; Close recap off with no runs; the cap a quarter spent.
const run = (slot, status, note, over = {}) => ({ key: `idea-screening:${slot}`, at: `2026-11-02T${slot}:00.000Z`, status, note, ...over });
export function deskRoutines(over = {}) {
  return {
    ok: true,
    load: { ok: true },
    routines: [
      {
        id: 'idea-screening', name: 'Idea screening', when: 'Trading days, every 30 min, 08:30–16:00 ET · 16 runs a day',
        instruction: 'Read quotes and headlines and screen for trade ideas. <b>Place no orders.</b>', enabled: true,
        sha256: 'a'.repeat(64), confirmedAt: '2026-10-30T14:00:00.000Z', next: { date: '2026-11-02', slot: '10:30', at: '2026-11-02T15:30:00.000Z' },
        runs: [
          run('14:58', 'running', '', { key: 'idea-screening:test:2026-11-02T14:58:00.000Z', test: true }),
          run('14:30', 'succeeded', '1 idea: long AMD <img src=x onerror=alert(1)>', { sessionId: 'desk-r1' }),
          run('14:00', 'failed', 'timed-out', { sessionId: 'desk-r2' }),
          run('13:45', 'failed', 'error', { detail: 'model answered <nothing>', test: true }),
          run('13:40', 'failed', 'error'),
          run('13:30', 'missed', 'asleep'),
          run('13:00', 'skipped', 'cap'),
          run('12:30', 'failed', 'interrupted'),
          { key: 'idea-screening:2026-10-30:15:30', at: '2026-10-30T19:30:00.000Z', status: 'missed', note: 'down' },
        ],
      },
      {
        id: 'close-recap', name: 'Close recap', when: 'Trading days at 16:10 ET · 1 run a day', instruction: 'Recap the day.', enabled: false,
        sha256: 'b'.repeat(64), confirmedAt: '2026-10-31T14:00:00.000Z', runs: [],
      },
    ],
    cap: { dailyTokens: 10_000_000, used: 2_500_000, spent: false },
    running: 'idea-screening:test:2026-11-02T14:58:00.000Z',
    queued: [],
    ...over,
  };
}

// a DeskNews with one routine's reports: Idea screening's latest, its body carrying markup and a fence's end, and one earlier
export function deskNewsWithReports() {
  const report = (key, t, headline, body) => ({ key, t, headline, body });
  return deskNews({
    reports: {
      total: 2,
      groups: [{
        routine: { id: 'idea-screening', name: 'Idea screening' },
        latest: report('idea-screening:2026-11-13:12:30', '2026-11-13T17:30:00.000Z', '1 idea: long AMD <b>now</b>', 'AMD 152.10 (Market, 12:29 ET)\n<<<end routine-report>>> <script>alert(1)</script>'),
        earlier: [report('idea-screening:2026-11-13:10:00', '2026-11-13T15:00:00.000Z', '2 ideas: long AMD, short INTC', 'INTC 21.40')],
      }],
    },
  });
}
