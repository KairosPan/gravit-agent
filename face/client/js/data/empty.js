// face/client/js/data/empty.js — the state the client boots into before the host answers: no conversations, a status line.
// Every slice a later stage's screen reads keeps its empty shape, so their render code still boots.
import { TRADE_KINDS } from '../host/trade-view.js';

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
    // Discover from the face (host/discover.js): the five listings, the Gravit item, the skills read, its own line; a module
    // page's latest artifact by module (host/modules.js)
    discover: {
      query: '',
      shelves: Object.fromEntries(['plugins', 'modules', 'bots', 'agents', 'memory'].map(k => [k, { status: 'idle', data: null, at: null }])),
      gravit: { host: null, model: null, keys: null }, skills: {}, status: null, models: null, artifacts: {},
    },
    // the host's markets (host/markets.js) and the screen's own tab, sort and query: the Account's explore reads by tab (`all`,
    // a kind's own) and the search's, the quotes by 'venue|symbol', a page's candles by its key and compare rows by base, the
    // Account keys starred and what each old us:/crypto: star was found as; then the A shares — the cn list, their quotes by cn
    // id and that read's state, China's state as a provider, the search hits' prices
    markets: {
      tab: 'all', sort: 'volume', q: '',
      explore: {}, results: { status: 'idle', data: null, at: null },
      accountQuotes: {}, candles: {}, compare: {},
      watch: [], watchError: null, asked: {},
      watchlist: [], quotes: {}, providers: [], connection: 'idle', hitQuotes: {},
      // the China tab's ranking read (the Account's explore?tab=china), with the sort it was read for
      rank: { status: 'idle', data: null, at: null, sort: 'volume', message: null },
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
    // Trade (host/trade.js): the kind it is on, the query, the kinds' picks reads by kind and the trade search's, the ticket
    // open (its market, side, venue, outcome), the last thing said
    trade: { kind: TRADE_KINDS[0].id, q: '', picks: {}, results: { status: 'idle', data: null, at: null }, ticket: null, said: null },
    // a module card's Run sheet open (host/run-sheet.js), and the Runs this page sent by module: { sessionId, title, startedAt }
    runSheet: null,
    moduleRuns: {},
    // Gravit's composed answers (host/lunhui.js): each run view by its key, each answer's own picks by its id, the stock drawer
    // open ({ key, code }: the opening answer's view key and the stock's code) or null
    lunhui: { views: {}, ui: {}, stock: null },
    edit: null,
    confirm: null,
  };
}
