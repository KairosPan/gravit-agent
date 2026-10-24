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
    // the host's markets (host/markets.js) and the screen's own tab, sort and query: the Account's explore reads by tab (`all`,
    // a kind's own) and the search's, the quotes by 'venue|symbol', a page's candles by its key and compare rows by base, the
    // Account keys starred and what each old us:/crypto: star was found as; then the face's own wire for the A shares as today
    markets: {
      tab: 'all', sort: 'volume', q: '',
      explore: {}, results: { status: 'idle', data: null, at: null },
      accountQuotes: {}, candles: {}, compare: {},
      watch: [], watchError: null, asked: {},
      watchlist: [], quotes: {}, providers: [], connection: 'idle',
      search: { query: '', status: 'idle', assets: [], partial: false }, hitQuotes: {},
    },
    // the Account (host/account.js): its page with the sentence of its last refusal, its other reads, the history curve's
    // range, the Statement drawer, and the venue whose Details drawer is open (its id); and the connect sheet's reads — where
    // this account can connect, the kept paper books, the last key file's check with what it asked, a venue's reach
    account: {
      status: 'idle', data: null, at: null, message: null,
      holdings: { status: 'idle', data: null, at: null },
      paper: { status: 'idle', data: null, at: null },
      history: { status: 'idle', data: null, at: null, range: '1d' },
      statement: { status: 'idle', data: null, at: null },
      agents: { status: 'idle', data: null, at: null },
      venuesHere: { status: 'idle', data: null, at: null, message: null },
      paperBooks: { status: 'idle', data: null, at: null, message: null },
      keyfile: { status: 'idle', data: null, at: null, message: null, asked: null },
      reach: { status: 'idle', data: null, at: null, message: null },
      statementOpen: false,
      detailsVenue: null,
    },
    // the Account seat's standing (host/seat.js): /data/seat.json as read
    seat: { status: 'idle', data: null, at: null },
    // the owner device (host/owner.js): whether this page signs for the Account, its key's id there, the Account's last
    // refusal to it, a pairing or sign-out in the air
    owner: { role: 'unknown', kid: '', refusal: null, busy: false },
    // the owner sheet open (host/sheet.js): prepare, What you sign, sign — none open
    sheet: null,
    edit: null,
    confirm: null,
  };
}
