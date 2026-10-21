// face/client/js/data/empty.js — the state the client boots into before the host answers: no conversations, a status line.
// Every slice a later stage's screen reads keeps its empty shape, so their render code still boots.
export function emptyState() {
  return {
    theme: 'system',
    route: { screen: 'messages', id: null },
    lastConv: null,
    railCollapsed: false,
    collapsed: {},
    draft: null,
    detailsOpen: false,
    settingsOpen: false,
    conversations: [],
    childRows: [],
    // a room member's trace by the answer it explains, under its conversation (host/traces.js)
    traces: {},
    channels: [],
    // the channel page's read (host/channels.js)
    channel: { id: null, status: 'idle', data: null, at: null },
    bots: [],
    status: { line: 'connecting…', bad: false, connected: false },
    orphanGates: {},
    lastSeen: {},
    // Discover from the face (host/discover.js): the four listings, the Gravit item, the skills read, its own line
    discover: {
      query: '',
      shelves: Object.fromEntries(['plugins', 'bots', 'agents', 'memory'].map(k => [k, { status: 'idle', data: null, at: null }])),
      gravit: { host: null, model: null, keys: null }, skills: {}, status: null, models: null,
    },
    // the host's markets (host/markets.js) and the screen's own tab, sort and query
    markets: {
      tab: 'all', sort: 'volume', q: '',
      watchlist: [], watchError: null, quotes: {}, providers: [], connection: 'idle',
      search: { query: '', status: 'idle', assets: [], partial: false }, hitQuotes: {}, bars: {},
    },
    // the host's account (host/account.js) and the Statement drawer
    account: { status: 'idle', data: null, at: null, creds: null, tools: null, probe: [], statementOpen: false },
    // the Account seat's standing (host/seat.js): /data/seat.json as read
    seat: { status: 'idle', data: null, at: null },
    edit: null,
    confirm: null,
  };
}
