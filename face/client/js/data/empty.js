// face/client/js/data/empty.js — the state the client boots into before the host answers: no conversations, a status line.
// Every slice a later stage's screen reads keeps its empty shape, so their render code still boots.
import { TRADE_KIND_IDS } from '../host/trade-view.js';
import { said } from '../i18n/words.js';

export function emptyState() {
  return {
    theme: 'system',
    // the face's language, a code (i18n/langs.js); the table itself is words.js's, set before the store is made
    lang: 'en',
    // the text and code sizes in px and the two font families ('' the default), js/prefs.js
    textSize: 15,
    codeSize: 12,
    textFont: '',
    codeFont: '',
    route: { screen: 'messages', id: null },
    railCollapsed: false,
    // the narrow-screen list is an in-page disclosure, never a saved preference
    listOpen: false,
    // files are being dragged over the page: the drop overlay shows over a screen with a composer (plan 4)
    dropping: false,
    detailsOpen: false,
    settingsOpen: false,
    conversations: [],
    childRows: [],
    // a room member's trace by the answer it explains, under its conversation (host/traces.js)
    traces: {},
    channels: [],
    // the channels read has answered — listed, empty or failed (host/live.js): an unknown strategy is then not found, not waited on
    channelsRead: false,
    // the operator's images in the thread by attachment id: a data: URL, or null for one the host cannot give back (plan 4)
    thumbs: {},
    // the image open at full size over the page, { attachmentId, name } (its src is its thumb), or null (plan 4)
    lightbox: null,
    // the shortcut sheet over the page, { q } (its box's words), or null (keys.js; ⌘/ opens and closes it)
    shortcuts: null,
    // a strategy page's reads (host/channels.js): its channel's overview, and the paper positions of the venue its status.yaml
    // names
    channel: { id: null, status: 'idle', data: null, at: null, positions: { status: 'idle', venue: null, rows: [], message: null } },
    bots: [],
    status: { line: said('status.connecting'), bad: false, connected: false },
    orphanGates: {},
    lastSeen: {},
    // Discover from the face (host/discover.js): the five listings, the Gravit item, the skills read, its own line; a module
    // page's latest artifact by module (host/modules.js); the one roster its switches draw from (one-entry plan 4)
    discover: {
      query: '',
      shelves: Object.fromEntries(['plugins', 'modules', 'bots', 'agents', 'memory'].map(k => [k, { status: 'idle', data: null, at: null }])),
      gravit: { host: null, model: null, keys: null }, skills: {}, status: null, models: null, artifacts: {},
      roster: { status: 'idle', agents: [], bots: [] },
    },
    // the host's markets (host/markets.js) and the screen's own tab, sort and query: the Account's explore reads by tab (`all`,
    // a kind's own) and the search's, the quotes by 'venue|symbol', a page's candles by its key and compare rows by base, the
    // Account keys starred and what each old us:/crypto: star was found as; then the A shares — the cn list, their quotes by cn
    // id and that read's state, China's state as a provider, the search hits' prices
    markets: {
      scope: 'hyperliquid', source: '', tab: 'all', sort: 'volume', q: '',
      sources: { status: 'idle', data: null, at: null },
      explore: {}, results: { status: 'idle', data: null, at: null },
      located: {},
      accountQuotes: {}, candles: {}, compare: {},
      watch: [], watchError: null, asked: {},
      watchlist: [], quotes: {}, providers: [], connection: 'idle', hitQuotes: {},
      // the China tab's ranking read (the Account's explore?tab=china), with the sort it was read for
      rank: { status: 'idle', data: null, at: null, sort: 'volume', message: null },
      // the market page on screen's four reads beside its price, by its key (plan 4a Task 4): `here` (the asset sheet), `book`,
      // `trades`, `funding` (a perpetual's) — each { status, data, at, message, freshAt }; dropped on leaving
      depth: {},
    },
    // the Account (host/account.js): its page with the sentence of its last refusal, its other reads, the history curve's
    // range, the Statement drawer, and the venue whose Details drawer is open (its id); and the connect sheet's reads — where
    // this account can connect, the kept paper books, the last key file's check with what it asked, a venue's reach; the Rules
    // tab's Guard press (plan 4a Task 5): in the air, said, or refused in the Account's words; the browser wallet's sends by key
    // (plan 4b Task 1)
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
      guard: { status: 'idle', said: null, message: null },
      wallet: {},
      // the Money tab (plan 4b Task 2): Receive's addresses by row key, and a bridge's routes for the draft asked
      receive: {},
      routes: { asked: null, status: 'idle', data: null, message: null },
      // Earn (plan 4b Task 3): the products and what is in them, and what the last taken earn said
      earn: { status: 'idle', data: null, at: null, message: null, said: null },
      // the connect sheet's browser wallet (plan 4b Task 4): the wallets this page found, asked or signed for an address, or
      // refused in the wallet's or the Account's words; a venue's sign-in started from it, by its connector — starting, waiting
      // for the owner on the venue's page (`tab` false when no tab opened, so the venue's link is drawn instead), ready, failed,
      // run out; and Close to agents by venue: in the air, said, or refused in the Account's words
      connectWallet: { status: 'idle', wallets: [], wallet: '', address: '', message: null },
      signIn: { status: 'idle', connector: '', url: '', tab: false, state: '', message: null },
      closing: {},
      grantSaid: null,
      statementOpen: false,
      detailsVenue: null,
    },
    // Account › Identity (plan B1b): the account's identity read (host/account.js loadIdentity) with the sentence of its last
    // failure, the Connect Telegram sheets (Task 2) or null, the grid's unsaved ticks (a routing) or null, Details open
    identity: { status: 'idle', data: null, message: null, connect: null, draft: null, details: false },
    // the Account seat's standing (host/seat.js): /data/seat.json as read
    seat: { status: 'idle', data: null, at: null },
    // the desk's status (host/desk.js): /data/desk/status as last read, read while Markets shows; the sentence of the last failure
    desk: { status: 'idle', data: null, at: null, message: null },
    // the list's search (host/search.js): the box, the content read's phase, its items
    search: { query: '', contentPhase: 'idle', content: [], hasMore: false },
    // the open conversation's background jobs (host/jobs.js): the one watched, its rows, the job open in Details, the finished
    // ids cleared by conversation; a job's output stays in host/jobs.js
    jobs: { convId: null, rows: [], open: null, cleared: {} },
    // the conversation's tasks (host/tasks.js): GET /data/tasks as last read — `off` when the face has no conversation, `failed`
    // keeping the last items — and the ids with a Stop or Continue in flight
    tasks: { status: 'loading', conversation: null, items: [], desk: { scheduled: [], lines: [] }, at: null, busy: [] },
    // the owner device (host/owner.js): whether this page signs for the Account, its key's id there, the Account's last
    // refusal to it, a pairing or sign-out in the air
    owner: { role: 'unknown', kid: '', refusal: null, busy: false },
    // Sell many's drawer (host/sell-many.js, plan 4b Task 3): reading, picking, reviewing, running, done — none open
    sellMany: null,
    // the owner sheet open (host/sheet.js): prepare, What you sign, sign — none open
    sheet: null,
    // Trade (host/trade.js): the kind it is on, the query, the kinds' picks reads by kind and the trade search's, the ticket
    // open (its market, side, venue, outcome), the last thing said
    trade: { kind: TRADE_KIND_IDS[0], q: '', picks: {}, results: { status: 'idle', data: null, at: null }, ticket: null, said: null },
    // a module card's Run sheet open (host/run-sheet.js), and the Runs this page sent by module: { sessionId, title, startedAt }
    runSheet: null,
    moduleRuns: {},
    // Gravit's composed answers (host/lunhui.js): each run view by its key, each answer's own picks by its id, the stock drawer
    // open ({ key, code }: the opening answer's view key and the stock's code) or null
    lunhui: { views: {}, ui: {}, stock: null },
    // the event analog tables (host/analog.js): each task read by its id and each event view by its id
    analog: { tasks: {}, views: {} },
    edit: null,
    confirm: null,
  };
}
