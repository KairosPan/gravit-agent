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
