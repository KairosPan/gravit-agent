// A DeskStatus as GET /data/desk/status answers it (src/desk.ts deskStatus, src/watch.ts WatchStatus), read at DESK_NOW:
// 10:00 ET on Monday 2026-11-02 (EST, UTC-5), 23:00 in Beijing. The watch runs: US polling its session, the A shares' closed;
// one US alert sent, one capped, one queued; one A-share alert sent and one muted, both on Beijing's 2 November, which is
// New York's 1 November; a mute until 11:00 ET; filings off for want of a contact; levels.yml loaded with one refusal; a
// standing order with a finished firing; two runs, the first lost; one sleep gap.
export const DESK_NOW = Date.parse('2026-11-02T15:00:00.000Z');

const today = ({ sent = 0, suppressed = {}, repeats = 0 } = {}) => ({ sent, suppressed: { cooldown: 0, cap: 0, muted: 0, off: 0, window: 0, ...suppressed }, repeats });

export function deskStatus() {
  return {
    ok: true, pid: 4242, version: '0.2.0-rc.2', bootedAt: '2026-11-02T11:55:00.000Z', uptimeMs: 3 * 3_600_000 + 5 * 60_000,
    desk: { enabled: true, dir: '/scratch/face/desk' },
    asleep: [{ from: '2026-11-02T13:00:00.000Z', to: '2026-11-02T13:20:00.000Z', gapMs: 1_200_000 }],
    runs: [
      { bootedAt: '2026-11-01T12:00:00.000Z', pid: 4000, lost: true },
      { bootedAt: '2026-11-02T11:55:00.000Z', pid: 4242, lost: false },
    ],
    turnsToday: { count: 2, usage: { uncachedInputTokens: 1_000_000, outputTokens: 34_567, cacheReadTokens: 200_000, cacheWriteTokens: 0 } },
    budget: { dailyTokens: 2_000_000, used: { uncachedInputTokens: 1_000_000, outputTokens: 34_567, cacheReadTokens: 200_000, cacheWriteTokens: 0, total: 1_234_567 }, spent: false },
    telegram: { configured: false, polling: false, dropped: 0, queued: 0 },
    standing: {
      file: { path: '/scratch/face/desk/standing.yml', state: 'loaded', loadedAt: '2026-11-02T11:55:01.000Z' },
      calendar: { clock: 'XNYS', state: 'ok' },
      orders: [{
        id: 'brief', dir: 'strategies/cn-market', file: 'brief.md', at: '09:20', wake: false, enabled: true, expires: '2026-12-31', expired: false,
        hash: 'ok', nextAnchor: '2026-11-03T14:20:00.000Z',
        last: { key: 'brief:2026-11-02', order: 'brief', date: '2026-11-02', kind: 'finished', outcome: 'finished', t: '2026-11-02T14:31:00.000Z' },
      }],
      queued: [],
      recent: [{ key: 'brief:2026-11-02', order: 'brief', date: '2026-11-02', kind: 'finished', outcome: 'finished', t: '2026-11-02T14:31:00.000Z', wallMs: 64_000 }],
    },
    watch: {
      state: 'watching',
      markets: {
        us: {
          state: 'polling', session: { date: '2026-11-02', open: '2026-11-02T14:30:00.000Z', close: '2026-11-02T21:00:00.000Z' },
          watched: 2, notWatched: [], lastPollAt: '2026-11-02T14:59:30.000Z', today: today({ sent: 1, suppressed: { cap: 1 } }),
        },
        cn: {
          state: 'after-close', session: { date: '2026-11-02', open: '2026-11-02T01:30:00.000Z', close: '2026-11-02T07:00:00.000Z' },
          watched: 1, notWatched: [], lastPollAt: '2026-11-02T06:59:50.000Z', today: today({ sent: 1, suppressed: { muted: 1 } }),
        },
      },
      muted: { setAt: '2026-11-02T14:00:00.000Z', by: 'telegram', until: '2026-11-02T16:00:00.000Z' },
      files: [
        { file: 'desk/levels.yml', kind: 'levels', entries: 2, refusals: [{ file: 'desk/levels.yml', index: 2, symbol: 'TSLA', reason: 'price must be a positive number' }], loadedAt: '2026-11-02T11:55:02.000Z' },
        { file: 'desk/holdings.yml', kind: 'holdings', missing: true, entries: 0, refusals: [] },
      ],
      near: [],
      marks: [
        { market: 'us', symbol: 'NVDA', kind: 'stop', level: '170', when: 'cross_down', plan: 'sell half on a close below 170', file: 'desk/levels.yml', distancePct: -1.3 },
        { market: 'cn', symbol: '600519', kind: 'buy_zone', level: '1600-1650', when: 'enter', plan: 'add 100 shares in the zone', file: 'desk/levels.yml', distancePct: null },
      ],
      pending: 0,
      recent: [
        { id: 'a-000000000005', t: '2026-11-02T14:58:00.000Z', market: 'us', symbol: 'NVDA', label: 'stop', gap: false, price: 169.8, feed: 'ROBINHOOD', outcome: 'sent', latencyMs: 1800, receivedMs: 900 },
        { id: 'a-000000000004', t: '2026-11-02T14:50:00.000Z', market: 'us', symbol: 'AMD', label: 'move-3', gap: false, price: 151.2, feed: 'NASDAQ', outcome: 'queued', latencyMs: null },
        { id: 'a-000000000003', t: '2026-11-02T14:40:00.000Z', market: 'us', symbol: 'AMD', label: 'move-3', gap: true, price: 150.1, feed: 'NASDAQ', outcome: 'suppressed', suppressed: 'cap', latencyMs: null },
        { id: 'a-000000000002', t: '2026-11-02T02:15:00.000Z', market: 'cn', symbol: '600519', label: 'buy_zone', gap: false, price: 1610, feed: 'TENCENT', outcome: 'sent', latencyMs: 2400 },
        { id: 'a-000000000001', t: '2026-11-02T02:10:00.000Z', market: 'cn', symbol: '600519', label: 'move-2', gap: false, price: null, feed: null, outcome: 'suppressed', suppressed: 'muted', latencyMs: null },
      ],
      filings: { state: 'no-contact', symbols: 0, aShares: 0, seeded: 0 },
    },
  };
}
