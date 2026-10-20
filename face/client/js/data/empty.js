// face/client/js/data/empty.js — the state the client boots into before the host answers: no conversations, a status line.
// Every slice a later stage's screen reads keeps its empty shape, so their render code still boots.
export function emptyState() {
  return {
    theme: 'system',
    route: { screen: 'messages', id: null },
    lastConv: null,
    railCollapsed: false,
    draft: null,
    detailsOpen: false,
    settingsOpen: false,
    conversations: [],
    channels: [],
    bots: [],
    status: { line: 'connecting…', bad: false, connected: false },
    orphanGates: {},
    lastSeen: {},
    discover: { query: '', installedOnly: false, create: null, toast: null },
    // the host's fields (host/markets.js) beside the demo's, which leave in stage 2's Tasks 6 and 8
    markets: {
      tab: 'all', sort: 'volume', q: '', interval: '1h', watch: [],
      watchlist: [], watchError: null, quotes: {}, providers: [], connection: 'idle',
      search: { query: '', status: 'idle', assets: [], partial: false }, hitQuotes: {}, bars: {},
    },
    trade: { kind: 'crypto', q: '', ticket: null },
    plugins: { installed: [], mine: [], uploaded: [] },
    memory: { entries: [], remember: true, askFirst: false, botsRead: false },
    account: {
      mode: 'guard', netWorth: 0, today: 0, todayPct: 0, alloc: [], holdings: [], cash: {}, orders: [], venues: [],
      wallet: null, receive: null, activity: [], panel: null, connecting: null, copied: false, panelError: null,
      status: 'idle', data: null, at: null, creds: null, tools: null, probe: [], statementOpen: false,
    },
    banner: null,
    call: null,
    edit: null,
    confirm: null,
    compose: { files: [], listening: false },
    mail: { address: '', items: [] },
  };
}
