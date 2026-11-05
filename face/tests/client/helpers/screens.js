// The screen corpus: every state css.test.js draws, named, so a test can hold each screen to its bytes (words-golden.test.js)
// or to its classes (css.test.js). Paths below resolve from tests/client/helpers/.
import { readFileSync } from 'node:fs';
import { renderRail, renderList } from '../../../client/js/render/rail.js';
import { renderMessagesScreen } from '../../../client/js/render/messages.js';
import { renderMarketsScreen } from '../../../client/js/render/markets.js';
import { renderSettings, renderAccountScreen, renderSellMany } from '../../../client/js/render/account.js';
import { renderSheet } from '../../../client/js/render/owner.js';
import { renderConnectDrawer } from '../../../client/js/render/identity.js';
import { renderTradeScreen } from '../../../client/js/render/trade.js';
import { ticketOf } from '../../../client/js/host/trade-view.js';
import { fieldsOf } from '../../../client/js/host/sheet-view.js';
import { askedOf } from '../../../client/js/host/sheet.js';
import { renderChannelScreen } from '../../../client/js/render/channel.js';
import { renderDiscover, renderPlugin } from '../../../client/js/render/discover.js';
import { renderModule } from '../../../client/js/render/modules.js';
import { renderRunSheet } from '../../../client/js/render/run-sheet.js';
import { newSheet } from '../../../client/js/host/run-sheet-view.js';
import { MODULES } from '../../../client/js/host/modules-view.js';
import { listings, modulesListing } from './inventory.js';
import { setMarkdown } from '../../../client/js/render/thread.js';
import { reducers as R } from '../../../client/js/reducers/index.js';
import { emptyState } from '../../../client/js/data/empty.js';
import { MIN } from '../../../client/js/time.js';
import { VIEW_1027 } from './lunhui-view.js';
import { stockDrawerHtml } from '../../../client/js/render/lunhui/stock.js';
import { deskStatus } from './desk-status.js';
import { editorHtml, dropOverlay, lightboxHtml } from '../../../client/js/composer/view.js';
import { DEFAULT_LIMITS } from '../../../client/js/composer/files.js';
import { slashItems, atItems } from '../../../client/js/composer/menus.js';
import { sessionUri } from '../../../client/js/composer/draft.js';
import { SHEET_KINDS, letDeviceSeedOf, paperSeedOf, signOutSeedOf } from '../../../client/js/host/sheet-view.js';
import { closeSeedOf, amendSeedOf, leverageSeedOf } from '../../../client/js/host/sheet-market.js';
import { moveSeedOf, earnSeedOf, subWalletSeedOf } from '../../../client/js/host/sheet-money.js';
import { positionsOf, openOrdersOf } from '../../../client/js/host/account-view.js';
import { receiveRowsOf } from '../../../client/js/host/money-view.js';
import { earnPage, earnBody } from './earn-fixture.js';
import { createStore } from '../../../client/js/store.js';
import { startRunSheet } from '../../../client/js/host/run-sheet.js';
import { boot } from '../../../client/js/app.js';
import { fakeWindow } from './fake-dom.js';
import { valueEditor } from './value-editor.js';

// the corpus' clock: a local time, so a state's clock prints the same only under one zone (the golden sets America/New_York)
export const NOW = new Date(2026, 9, 19, 14, 7).getTime();
export const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const m = (id, over = {}) => ({ id, seq: 1, at: NOW, from: 'gravit', kind: 'text', text: 'hello', data: {}, ...over });
const KINDS = [
  m('e1', { from: 'you', text: 'hi' }), m('e2', { data: { markdown: true, interrupted: true } }), m('e3', { from: 'system', text: 'round 1' }),
  m('tc1', { kind: 'tool', text: 'bash', data: { callId: 'c1', title: 'ls', result: 'ok', isError: true } }),
  m('ev-1', { kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 's1', venue: 'paper-1', line: 'Account seat' } }),
  m('ev-2', { kind: 'approval', text: 'Run?', data: { eventId: 'ev-2', sessionId: 's1', toolName: 'bash', reason: 'audit', displayReason: 'Run?' } }),
  m('ev-3', { kind: 'question', text: '', data: { eventId: 'ev-3', sessionId: 's1', questions: [{ id: 'q1', question: 'Pin?', header: 'Gate', options: [{ label: 'Yes', description: 'd' }] }, { id: 'q2', question: 'More?' }] } }),
  m('ev-4', { kind: 'card', text: 'Done', answer: 'elsewhere', data: { eventId: 'ev-4', sessionId: 's1' } }),
  m('rc1', { kind: 'receipt', text: 'Order accepted', data: {} }), m('rc2', { kind: 'refusal', text: 'no', data: { code: 'E1' } }),
  m('e9', { from: 'buffett', text: '买', data: { name: '巴菲特型' } }),
  m('e10', { from: 'system', text: 'runtime snapshot', data: { source: 'runtime' } }),
  // Gravit's composed answers (Lunhui run view plan 2), their views loading, loaded, failed and loaded without breadth (lunhuiStates); the first folds e2
  ...['loading', 'loaded', 'failed', 'bare'].map((run, i) => m(`p${i}`, { kind: 'composed', text: '弱势日', data: { callId: String(i), strategy: 'cn-market', run, summary: '弱势日', blocks: [{ kind: 'verdicts' }, { kind: 'breadth', title: '涨跌' }, { kind: 'indices', focus: { from: '14:00', to: '15:00' } }, { kind: 'sources' }, { kind: 'ladder' }, { kind: 'yesterday' }, { kind: 'signals' }], choices: [{ label: 'Next', stock: 'sh600001' }], modules: [] } })),
];
// the composed answers' views by state (host/lunhui.js viewKey)
// (ui: the loaded answer s1-p1 with no picks, then with a tile open and its breadth by change)
// the stock drawer open on the loaded answer's view (plan 3, task 4): a limit-up with its line, a first board without, a name the
// view does not hold, and the drawer over a view loading and failed
const stockStates = s => [['loaded', '600011'], ['loaded', '600001'], ['loaded', '002001'], ['loaded', '999999'], ['loading', '600001'], ['failed', '600001']]
  .map(([run, code]) => { const l = lunhuiStates(s); return { ...l, lunhui: { ...l.lunhui, stock: { key: `cn-market/${run}/`, code } } }; });
const lunhuiStates = (s, ui = {}) => ({ ...s, lunhui: { views: { 'cn-market/loading/': { status: 'loading' }, 'cn-market/loaded/': { status: 'loaded', view: VIEW_1027 }, 'cn-market/failed/': { status: 'failed', error: 'HTTP 404' }, 'cn-market/bare/': { status: 'loaded', view: { ...VIEW_1027, breadth: null } } }, ui } });

const asset = (id, over = {}) => ({ id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), name: id.slice(id.indexOf(':') + 1), exchange: 'NASDAQ', currency: id.startsWith('cn:') ? 'CNY' : 'USD', ...over });
const quote = (id, over = {}) => ({ id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), price: 10, prev_close: 9, change: 1, change_pct: 1.5, volume: 1000, as_of: '2026-10-19T14:30:00Z', received_at: null, volume_as_of: null, source: 'Alpaca', feed: 'iex', basis: 'previous_close', quote_status: 'live', market_status: 'closed', message: '', ...over });
// Markets over the stand-in's answers (tests/fixtures/account/): before a read; the Account's rows with an A share, a star the
// Account could not find, a quote in view and events (one past its end); a kind's tab; Watching with a placeholder; Closing
// soonest; searching (its hits, on its way, refused); the face's wire polling; a full watchlist; a market's page with its history,
// its venues, what is held, working and stated, and a conversation naming it; an event's page with its outcomes; a page reading
// its history; an A share's page; a key no read lists
function marketStates() {
  const fx = name => JSON.parse(readFileSync(new URL(`../../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
  const on = R.nav(emptyState(), { screen: 'markets', id: null });
  const all = fx('explore-all');
  all.items.push(fx('explore-predictions').items[0], {
    key: 'pm:0xab', kind: 'event', name: 'Will it rain in Paris on Sunday?', price: 0.12, change24h: -0.01, volumeUsd24h: 18000, category: 'Climate',
    closeTime: '2026-10-20T00:00:00.000Z', pastEnd: true, tabs: ['all', 'predictions'], at: [],
  });
  let read = R.exploreLoaded(on, { tab: 'all', data: all, at: NOW });
  read = R.watchlistLoaded(read, { items: [asset('cn:600519', { name: 'Kweichow Moutai', exchange: 'SH' }), asset('us:ZZZZ', { name: 'Zed Corp' })], error: null });
  read = R.askedOfAccount(read, { faceId: 'us:ZZZZ', key: null });
  read = R.quotesUpdated(read, { quotes: { 'cn:600519': quote('cn:600519', { change_pct: -1 }) }, providers: [], status: 'streaming' });
  read = R.accountQuotesLoaded(read, { quotes: [{ venue: 'broker', symbol: 'NVDA', market: { price: 183.1, quoteAt: '2026-10-19T14:00:00Z', quoteFrom: 'Stand-in Broker · real time' } }] });
  const starred = R.accountWatchLoaded(read, { items: ['coin:BTC', 'kalshi:KXGONE'], error: null });
  const withAccount = s => R.statementLoaded(R.holdingsLoaded(R.accountLoaded(s, { data: fx('account'), at: NOW }), { data: fx('holdings'), at: NOW }), { data: fx('statement'), at: NOW });
  const page = (id, s = read) => R.nav(withAccount(s), { screen: 'markets', id });
  const searching = q => R.setMarketsQuery(read, q);
  return [
    on, read, R.setMarketsTab(read, 'stocks'), R.setMarketsTab(starred, 'watching'), R.setMarketsSort(read, 'closing'),
    R.resultsLoaded(searching('fed'), { data: fx('explore-predictions'), at: NOW }), searching('zz'),
    R.resultsFailed(searching('zz'), { at: NOW, message: 'The account is busy' }),
    R.quotesUpdated(R.setMarketsTab(read, 'stocks'), { quotes: {}, providers: [], status: 'polling' }),
    R.watchlistLoaded(read, { items: read.markets.watchlist, error: 'full' }),
    { ...R.candlesLoaded(page('coin:BTC', starred), { id: 'coin:BTC', range: '1D', data: fx('candles'), at: NOW }), conversations: [conv('s7', { title: 'Is BTC cheap?' })] },
    page('event:predict:SI-FEDCUT-DEC'),
    // a market page's four reads (plan 4a Task 4): You here with what agents do here, the order book
    R.depthLoaded(R.depthLoaded(page('coin:SOL'), { id: 'coin:SOL', part: 'here', data: fx('asset-sol'), at: NOW }), { id: 'coin:SOL', part: 'book', data: fx('book'), at: NOW }),
    R.candlesLoading(page('stock:NVDA'), { id: 'stock:NVDA', range: '5D' }),
    page('cn:600519'), page('coin:GONE'),
    // an A share's 5D history: the sessions on one grid, the previous close dashed, a hairline between sessions
    R.candlesLoaded(R.setRange(page('cn:600519'), { id: 'cn:600519', range: '5D' }), { id: 'cn:600519', range: '5D', at: NOW,
      data: { ok: true, range: '5D', sessions: ['2026-10-29', '2026-10-30'].map(date => ({ date, prec: 100, price: [100, 101, 102], amount: [1, 1, 1] })) } }),
    // the desk (plan 2026-11-01-desk-p3-watch Task 11): the Desk tab, before its status and with it; a level's mark on its row
    // and on its page
    R.setMarketsTab(read, 'desk'), R.deskLoaded(R.setMarketsTab(read, 'desk'), { data: deskStatus(), at: NOW }),
    R.deskLoaded(read, { data: deskStatus(), at: NOW }), R.deskLoaded(page('stock:NVDA'), { data: deskStatus(), at: NOW }),
  ];
}

// Account over the stand-in's answers (tests/fixtures/account/): Portfolio read (stale, after a refusal), a page the face does
// not recognise, failed with nothing loaded, loading, the Statement open, Settings, Venues with a venue's Details, Agents, Cards
function accountStates() {
  const fx = name => JSON.parse(readFileSync(new URL(`../../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
  const on = R.nav(emptyState(), { screen: 'account', tab: 'portfolio' });
  let read = R.accountLoaded(on, { data: fx('account'), at: NOW });
  for (const [loaded, name] of [['holdingsLoaded', 'holdings'], ['paperLoaded', 'holdings-paper'], ['historyLoaded', 'history'], ['statementLoaded', 'statement'], ['agentsLoaded', 'agents']]) {
    read = R[loaded](read, { data: fx(name), at: NOW });
  }
  const seated = R.seatLoaded(read, { data: { ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-19T14:00:00Z', mode: 'guard', writes: { on: true, capUsd: 100 }, seat: { name: 'Gravit', status: 'admitted', address: '0xab12', limits: [] }, venues: [], cards: [] }, at: NOW });
  const at = tab => R.nav(seated, { screen: 'account', tab });
  return [
    R.accountFailed(read, { at: NOW, message: 'The Account is locked until its owner signs in.' }), R.accountLoaded(on, { data: { ok: true, available: false }, at: NOW }), R.accountFailed(on, { at: NOW }), R.accountLoading(on),
    R.openStatement(read), R.openSettings(read), R.openVenueDetails(at('venues'), 'ex'), at('agents'), at('cards'), ...ownerStates(read),
    // the owner's keys on a page that signs, one Revoke asked twice
    ...['agents', 'cards'].map(tab => R.ownerStanding(at(tab), { role: 'signs', kid: 'a5048199a8081854' })),
    R.askConfirm(R.ownerStanding(at('agents'), { role: 'signs', kid: 'a5048199a8081854' }), { action: 'revoke', name: 'Claude Code', address: '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6' }),
    // the Venues' keys on a page that signs: one Disconnect asked twice, a paper venue's Details with Top up and Start over
    R.askConfirm(R.openVenueDetails(R.ownerStanding(at('venues'), { role: 'signs', kid: 'a5048199a8081854' }), 'paper-momentum'), { action: 'disconnect', venue: 'ex', name: 'Stand-in Exchange' }),
    // Sell many's drawer (plan 4b Task 3): the picks, then the legs with their answers
    ...sellManyStates(R.ownerStanding(read, { role: 'signs', kid: 'a5048199a8081854' })),
    // Identity (plan B1b Task 1): connected with Details open, a stranger and a draft, on a page that signs; nothing connected on one
    // that does not; the account not answering
    ...identityStates(at('identity')),
  ];
}

function identityStates(base) {
  const read = {
    ok: true, networks: [{ network: 'telegram', speaksAs: '@gravit_desk_bot', talksOnlyWith: '@pan', since: '2026-11-03T15:20:00.000Z', fingerprint: 'ab12cd34', state: 'connected', polling: false, pollFailing: { since: '2026-11-04T14:00:00.000Z', reason: 'ENOTFOUND' } }],
    routing: { chat: ['telegram'], alerts: [], brief: [], cards: [], fills: [] }, quiet: { from: '23:00', to: '07:00', zone: 'America/New_York' },
    strangers: [{ network: 'telegram', sender: '0123456789ab', masked: '…789', count: 3, last: '2026-11-04T13:02:00.000Z' }],
  };
  const signing = R.ownerStanding(R.identityLoaded(base, read), { role: 'signs', kid: 'a5048199a8081854' });
  return [
    R.identityTick(R.identityDetails(signing), { row: 'brief', network: 'telegram', on: true }),
    R.identityLoaded(base, { ok: true, networks: [], routing: {}, quiet: null, strangers: [] }),
    R.identityFailed(base, 'The account did not answer.'),
    // Connect Telegram (Task 2): sheets 1 to 3 in the drawer (2 with its QR and a conflict, 3 refused with Start again), and sheet 4
    // the owner sheet, refused
    ...connectStates(signing),
  ];
}

function connectStates(signing) {
  const pending = { id: '0123456789abcdef0123456789abcdef', network: 'telegram', bot: { id: '777', username: 'gravit_desk_bot', name: 'Gravit' }, link: 'https://t.me/gravit_desk_bot', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'conflict' };
  const heard = { ...pending, state: 'heard', sender: { id: '555000123', name: 'Pan', handle: '@pan', masked: '…123', text: '/start' } };
  const open = R.identityConnectOpen(signing);
  const seed = { pending: pending.id, botId: '777', speaksAs: '@gravit_desk_bot', operatorId: '555000123', talksOnlyWith: '@pan', routing: 'chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram', keyHash: 'a'.repeat(64), salt: 'b'.repeat(32) };
  return [
    R.identityConnectSet(open, { busy: true, error: 'Paste the token from BotFather first.' }),
    R.identityConnectSet(open, { step: 2, pending }),
    R.identityConnectSet(open, { step: 3, pending: heard, error: 'This connection is gone: it expired or was closed. Start again.' }),
    R.sheetRefused(R.sheetOpen(signing, { kind: 'connectNetwork', seed, fields: [] }), { message: 'This connection is gone: it expired or was closed. Start again.' }),
  ];
}

function sellManyStates(base) {
  const it = asset => ({ asset, venue: 'ex', venueName: 'Stand-in Exchange', action: 'sell', symbol: `${asset}/USDT`, held: 2, sellQty: 2, usd: 20, ready: true });
  const prepared = { action: { type: 'liveOrder' }, shown: [{ name: 'Sell', value: 'SOL/USDT' }], quote: { order: { words: 'sell 2 SOL', notionalUsd: 20 } } };
  const picking = { status: 'picking', venue: '', items: [it('SOL'), it('ETH')], hidden: 1, missing: [], picked: [0], qtys: {}, legs: [], full: false };
  return [R.sellManySet(base, picking), R.sellManySet(base, { ...picking, status: 'reviewing', legs: [{ item: it('SOL'), state: 'ready', prepared }, { item: it('ETH'), state: 'refused', why: 'no' }] })];
}

// the owner device (render/owner.js): the pair box, Sign in, Devices with a device waiting; the sheets — a Let in incomplete, a
// limit's pick, a card ready with its countdown, the same form changed under its preparation, a refusal with Prepare again
function ownerStates(read) {
  const prepared = JSON.parse(readFileSync(new URL('../../fixtures/account/prepared-card.json', import.meta.url), 'utf8'));
  const page = { ...read.account.data, signers: { ...read.account.data.signers, pendingDevices: [{ kid: '0123456789abcdef', at: '2026-10-19T14:00:00Z' }] } };
  const signs = R.ownerStanding(R.accountLoaded(read, { data: page, at: NOW }), { role: 'signs', kid: 'a5048199a8081854' });
  const sheet = (kind, seed, s = signs) => R.sheetOpen(s, { kind, seed, fields: fieldsOf(kind, seed) });
  const card = sheet('approveCard', { card: 'card-0001', hash: '0xdf', decision: 'approve' });
  const ready = R.sheetPrepared(card, { prepared, at: NOW, asked: askedOf(card.sheet), deadline: NOW + 125_000 });
  const letIn = R.sheetPrepared(sheet('letIn', { address: '0x00000000000000000000000000000000000000ab', name: 'Claude Code' }), { prepared, at: NOW, asked: 'another draft', deadline: null });
  // a connect sheet with its check under the fields: the option elsewhere, so the check is the Account page
  const connect = sheet('connect', { options: [{ connector: 'live:robinhood', label: 'Robinhood', needs: 'sign-in', kind: 'robinhood', elsewhere: true }], connector: 'live:robinhood' });
  return [
    R.ownerStanding(read, { role: 'needs-code', kid: '' }), R.ownerStanding(read, { role: 'signed-out', kid: 'a5048199a8081854' }), R.openSettings(signs),
    sheet('letIn', {}), sheet('limit', { address: '0xb0b', name: 'Scout', venues: [{ id: 'paper-1', name: 'Paper', paper: true }] }), ready, letIn,
    R.sheetRefused(card, { message: 'prepare it again', again: true }), connect,
  ];
}

// Trade over the stand-in's answers: the picker with what was said and no ticket; a ticket nothing typed; ready with its quote,
// What you sign and the minutes, then changed under it; a prediction's ticket; a limit with extended hours; a refusal with
// Prepare again; a page that does not sign; a search on its way and the Account not read yet
function tradeStates() {
  const fx = name => JSON.parse(readFileSync(new URL(`../../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
  const all = fx('explore-all');
  all.items.find(i => i.key === 'stock:NVDA').at[0].session.extendedHours = true;
  const ready = d => ({ status: 'ready', data: d, at: NOW });
  const s0 = emptyState();
  const base = {
    ...s0, route: { screen: 'trade', id: null },
    markets: { ...s0.markets, explore: { all: ready(all) }, watch: ['coin:BTC'] },
    account: { ...s0.account, status: 'ready', data: fx('account'), holdings: ready(fx('holdings')) },
    owner: { ...s0.owner, role: 'signs', kid: 'a5048199a8081854' },
    trade: { ...s0.trade, picks: { crypto: ready({ ...all, items: all.items.filter(i => i.tabs.includes('crypto')) }), predictions: ready(fx('explore-predictions')) } },
  };
  const ticket = (open, fields = {}, s = base) => {
    const on = { ...s, trade: { ...s.trade, kind: open.kind ?? s.trade.kind, ticket: { id: open.id, side: open.side ?? 'buy', venue: open.venue ?? null, outcome: open.outcome ?? 0 } } };
    const t = ticketOf(on, NOW);
    return R.sheetOpen(on, { kind: 'order', seed: { id: open.id, ticket: t }, fields: { venue: t.venue, side: t.side, outcome: String(t.outcome), amount: '', unit: 'usd', orderType: 'market', limit: '', extendedHours: false, ...fields } });
  };
  const eth = ticket({ id: 'coin:ETH' }, { amount: '25' });
  const prepared = R.sheetPrepared(eth, { prepared: fx('prepared-order'), at: NOW, asked: askedOf(eth.sheet), deadline: NOW + 125_000 });
  return [
    { ...base, trade: { ...base.trade, said: 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange' } }, ticket({ id: 'coin:ETH' }), prepared,
    R.sheetField(prepared, { name: 'amount', value: '30' }), ticket({ id: 'event:predict:SI-FEDCUT-DEC', kind: 'predictions', side: 'sell', venue: 'predict' }),
    ticket({ id: 'stock:NVDA', kind: 'stocks', venue: 'broker' }, { orderType: 'limit', extendedHours: true }), R.sheetRefused(eth, { message: 'The price moved', again: true }),
    ticket({ id: 'coin:ETH' }, {}, { ...base, owner: { ...base.owner, role: 'pending' } }),
    { ...base, trade: { ...base.trade, q: 'zz', results: { status: 'loading', data: null, at: null } }, account: { ...s0.account, status: 'loading' } },
  ];
}

// the channel page: loaded with every section, loading, unavailable, stale after a failed re-read, not found
function channelStates() {
  const alpha = { workspaceId: 'w1', name: 'alpha', title: 'Alpha', dir: '/r/strategies/alpha', isRoot: false, missingDir: false, sessionIds: [] };
  const on = R.nav(R.hostList(emptyState(), { conversations: [conv('c1', { channel: { workspaceId: 'w1', name: 'alpha' } })], channels: [alpha] }), { screen: 'channel', id: 'w1' });
  const data = {
    ok: true, channel: alpha, status: { status: 'researching', one_line: 'Holds', next: 'Rerun', numbers: { sharpe: '1.4' } },
    body: { thesis: { markdown: '# A', isTemplate: false }, journal: [{ date: '2026-10-19', text: 'Ran' }], backtests: [{ file: 'b.json', bytes: 9 }], latest: { file: 'b.json', json: { sharpe: 1.4 } }, files: [{ name: 'n.md', bytes: 9, mtime: '2026-10-19T09:00:00.000Z' }] },
    agents: ['codex'], bots: ['buffett'], allBots: [{ id: 'buffett', name: 'Buffett Type', listed: true }],
  };
  const loaded = R.channelLoaded(on, { workspaceId: 'w1', data, at: NOW });
  const editing = R.editFailed(R.startEdit(loaded, { kind: 'roster', which: 'bots', workspaceId: 'w1', choices: [{ value: 'buffett', label: 'Buffett Type' }], ticked: ['buffett'] }), { error: 'roster write failed' });
  return [loaded, editing, R.channelLoading(on, { workspaceId: 'w1' }), R.channelFailed(on, { workspaceId: 'w1', at: NOW }), R.channelFailed(loaded, { workspaceId: 'w1', at: NOW }), R.nav(on, { screen: 'channel', id: 'w9' })];
}

// Discover: the shelves, a failed shelf, a query, a shelf's grid, every kind of page, its own line
export function discoverStates() {
  let all = emptyState();
  for (const [shelf, v] of Object.entries(listings())) all = R.shelfLoaded(all, { shelf, data: v.data, at: 1 });
  all = R.shelfLoaded(all, { shelf: 'modules', data: modulesListing(), at: 1 });
  const at = route => R.nav(all, route);
  const page = id => at({ screen: 'plugin', id });
  const unmounted = R.shelfLoaded(at({ screen: 'discover', id: null }), { shelf: 'modules', data: { ...modulesListing(), mounted: false }, at: 2 });
  return [
    unmounted, at({ screen: 'discover', id: 'research' }),
    // a card whose Run is running: its chip a link to the conversation
    R.moduleRunStarted(at({ screen: 'discover', id: 'research' }), { module: 'theme', sessionId: 's-run', title: 'Theme · 10-19', startedAt: NOW }),
    R.moduleRunStarted(at({ screen: 'module', id: 'theme' }), { module: 'theme', sessionId: 's-run', title: 'Theme · 10-19', startedAt: NOW }),
    at({ screen: 'discover', id: null }), R.shelfFailed(at({ screen: 'discover', id: null }), { shelf: 'bots', at: 1 }), R.nav(emptyState(), { screen: 'discover', id: null }),
    R.setDiscoverQuery(at({ screen: 'discover', id: null }), 'rules'), at({ screen: 'discover', id: 'agents' }),
    page('mcp:alpaca-kit'), page('bot:buffett'), page('agent:codex'), page('agent:claude'), page('agent:gravit'), page('bot:nobody'),
    R.gravitLoaded(page('agent:gravit'), { host: { cwd: '/r', home: '/h', attachedSessions: 1, version: 'v' }, model: false, keys: { DEEPSEEK_API_KEY: { configured: true } } }),
    R.skillLoaded(page('skill:rules'), { name: 'rules', detail: { content: '# R', group: 'mechanics' } }),
    R.discoverStatus(at({ screen: 'discover', id: null }), { line: 'connect: binary did not answer on this machine', bad: true }),
    R.modelsLoaded(R.startEdit(page('bot:buffett'), { kind: 'bot', id: 'buffett' }), { choices: [{ value: 'deepseek/deepseek-chat', label: 'DeepSeek · Chat' }] }),
    R.modelsLoaded(at({ screen: 'discover', id: 'create' }), { choices: [] }),
    R.shelfLoaded(page('bot:buffett'), { shelf: 'bots', data: { ok: true, bots: [{ ...listings().bots.data.bots[1], broken: 'cannot mount' }] }, at: 2 }),
    ...moduleStates(all),
  ];
}

// a Lunhui module's page: its latest artifact read, loading, failed; one with no run; before the listing; an unknown name
function moduleStates(all) {
  const at = id => R.nav(all, { screen: 'module', id });
  const ready = R.moduleArtifactLoaded(at('sentiment'), { module: 'sentiment', run: '20261028T020953Z-f3b89ce6', json: { module: 'sentiment' } });
  return [
    ready, R.moduleArtifactLoading(at('theme'), { module: 'theme' }), R.moduleArtifactFailed(at('counterevidence'), { module: 'counterevidence' }),
    R.shelfLoaded(at('mode'), { shelf: 'modules', data: { ok: true, mounted: true, channels: [] }, at: 2 }),
    R.nav(emptyState(), { screen: 'module', id: 'leader' }), at('nope'),
    ...runSheetStates(all),
  ];
}

// a module card's Run sheet: a market card with its source line, a Leader with a bad code and what was said, a strategy's
// review with its cite read-only, a Mode that cannot run
function runSheetStates(all) {
  const listing = modulesListing();
  const open = (module, over = {}) => R.runSheetOpen(R.nav(all, { screen: 'discover', id: null }), { ...newSheet(listing, module), ...over });
  return [
    open('theme'), open('leader', { stocks: 'sz300750', said: "Couldn't send — the conversation may exist untitled in the channel" }),
    open('counterevidence'), open('mode'),
  ];
}

// the list's search (plan 2 of the dsh UI port): searching, nothing found, failed, results with a marked snippet, an archived
// hit with Un-archive and the more-than-twenty line
export function searchStates(s) {
  const q = (q, then) => { const t = R.setSearchQuery(s, q); return then ? then(t, q) : t; };
  return [
    q('zz'), q('zz', (t, query) => R.searchContent(t, { query, items: [], hasMore: false })), q('zz', (t, query) => R.searchFailed(t, { query })),
    q('T', (t, query) => R.searchContent(t, { query, items: [{ sessionId: 's1', snippet: 'a T b', match: [2, 3] }], hasMore: true })),
  ];
}

// the states stage 1 can show: empty, a conversation with every kind, a group thinking, Details, Settings, a draft, a bad status, the rail folded
export function everyState() {
  const base = R.hostList(emptyState(), { conversations: [conv('s1', { messages: KINDS, running: true, usage: { tokenUsage: { outputTokens: 1 }, contextPressure: 0.5 }, stats: { turns: 1, steps: 2, llmMs: 900, toolMs: 0, ttftMs: 300, ttftSteps: 2, decodeMs: 500, decodeTokens: 20 }, created: NOW }), conv('g', { kind: 'group', members: ['gravit', 'buffett'], thinking: 'text', messages: [m('g1', { from: 'buffett', text: 'hold', data: { name: 'Buffett Type', markdown: true, memberSessionId: 'm1', memberTurn: 2 } })] })], channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true }, { workspaceId: 'w-cn', name: 'cn-market', isRoot: false }], bots: [{ id: 'buffett', name: 'Buffett Type' }] });
  const open = R.nav(base, { screen: 'messages', id: 's1' });
  return [
    emptyState(), open, lunhuiStates(open), ...stockStates(open), lunhuiStates(open, { 's1-p1': { tile: 'environment', breadth: 'dist' } }), R.nav(base, { screen: 'messages', id: 'g' }), R.toggleDetails(open), R.askConfirm(R.toggleDetails(open), { action: 'stopGravit', id: 's1' }),
    R.startEdit(R.toggleDetails(open), { kind: 'rename', convId: 's1', error: 'Cannot be empty' }), R.openSettings(open), R.startDraft(open, { now: NOW }),
    R.startEdit(R.startDraft(open, { now: NOW }), { kind: 'newChannel', error: 'Letters, digits, - or _' }),
    R.hostStatus(open, { line: 'Reconnecting…', bad: true }), R.toggleRail(open),
    ...searchStates(R.hostList(open, { conversations: [...open.conversations, conv('old', { title: 'T old', archived: 'face' })] })), R.hostPins(open, ['s1']),
    R.traceLoaded(R.nav(base, { screen: 'messages', id: 'g' }), { convId: 'g', msgId: 'g1', messages: [m('tg1', { kind: 'tool', text: 'account', data: { callId: 'g1c', name: 'mcp__alpaca-kit__account', result: JSON.stringify({ ok: true, equity: '1' }) } }), m('tg2', { from: 'system', text: 'context' })] }),
    R.toggleDetails(R.hostList(R.hostProjection(open, { convId: 's1', key: 'subagentCatalog', value: [{ id: 'k1', createdAt: 1, mode: 'continuable', label: 'Check' }, { id: 'k2', createdAt: 2, mode: 'unknown' }] }), { conversations: open.conversations, childRows: [{ sessionId: 'k1', parentSessionId: 's1', running: true, origin: 'subagent' }] })), ...marketStates(), ...accountStates(), ...channelStates(), ...discoverStates(), ...tradeStates(),
    // the golden is append-only (golden-write.js): a state added later goes after these, so every pinned name keeps its state
    ...laterStates(),
  ];
}

// added in plan 6's first fix round: Account's Money and Rules tabs; a sheet of every kind the owner signs; a move prepared,
// with its Can't be undone.; a market's order book, latest trades and a perpetual's funding; the watchlist's refusals by
// their codes, as the markets host writes them
function laterStates() {
  const fx = name => JSON.parse(readFileSync(new URL(`../../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
  const loaded = (page = fx('account')) => {
    let s = R.accountLoaded(R.nav(emptyState(), { screen: 'account', tab: 'portfolio' }), { data: page, at: NOW });
    for (const [done, name] of [['holdingsLoaded', 'holdings'], ['paperLoaded', 'holdings-paper'], ['statementLoaded', 'statement'], ['agentsLoaded', 'agents']]) s = R[done](s, { data: fx(name), at: NOW });
    return s;
  };
  const read = loaded();
  const signing = s => R.ownerStanding(s, { role: 'signs', kid: 'a5048199a8081854' });
  const tab = (s, name) => R.nav(s, { screen: 'account', tab: name });
  const page = read.account.data;
  const row = receiveRowsOf(page)[0];
  const key = row ? `${row.venue}|${row.asset}|${row.network}` : 'none';
  const money = [
    tab(read, 'money'), tab(signing(read), 'money'),
    R.receiveLoaded(tab(signing(read), 'money'), { key, data: { address: '0x00000000000000000000000000000000000000cd', tag: '123', whose: 'yours', note: 'checked' }, at: NOW }),
    R.receiveFailed(tab(read, 'money'), { key, at: NOW, message: 'The venue did not answer' }), R.receiveLoading(tab(read, 'money'), key),
    R.earnLoaded(tab(signing(loaded(earnPage())), 'money'), { data: earnBody(), at: NOW }), R.earnFailed(tab(loaded(earnPage()), 'money'), { at: NOW, message: 'Kraken did not answer' }),
  ];
  const rules = [
    tab(read, 'rules'), tab(signing(read), 'rules'), R.guardSaid(tab(signing(read), 'rules'), 'Guard is on'), R.guardRefused(tab(signing(read), 'rules'), 'refused'),
  ];
  // every kind's sheet, opened on a seed the screens would hand it, on a page that signs
  const signs = signing(read);
  const position = positionsOf(fx('holdings'))[0] ?? {};
  const order = openOrdersOf(page).map(o => amendSeedOf(o, page)).find(Boolean) ?? {};
  const owner = signs.owner;
  const ADDRESS = '0x00000000000000000000000000000000000000ab';
  const seeds = {
    endLimit: { address: ADDRESS, name: 'Claude Code', allow: ['paper-1'], scope: 'trade' }, revoke: { address: ADDRESS, name: 'Claude Code' },
    paper: paperSeedOf(page, null), topUp: { venue: 'paper-momentum', name: 'Momentum' }, resetPaper: { venue: 'paper-momentum', name: 'Momentum' },
    disconnect: { venue: 'ex', name: 'Stand-in Exchange' }, declineAsk: { ask: 'ask-1' }, letDevice: letDeviceSeedOf(page, owner, '0123456789abcdef'),
    signOut: signOutSeedOf(page, owner), reopen: { venue: 'ex', name: 'Stand-in Exchange' },
    close: closeSeedOf(position) ?? {}, amend: order, leverage: leverageSeedOf(position, page) ?? {},
    beast: {}, cap: { capUsd: 250 }, session: {}, leverageCap: {},
    move: moveSeedOf(page, { from: 'ex' }), earn: earnSeedOf(earnBody(), earnPage()), subWallet: subWalletSeedOf(page),
    disconnectNetwork: { network: 'telegram' }, block: { network: 'telegram', sender: '0a1b2c3d4e5f', masked: '…789' },
    routing: { routing: { chat: ['telegram'], alerts: [], brief: [], cards: [], fills: [] }, quiet: { from: '23:00', to: '07:00' }, saved: 'chat=telegram;alerts=;brief=;cards=;fills=' },
  };
  const kinds = [...SHEET_KINDS.filter(k => Object.hasOwn(seeds, k)), ...Object.keys(seeds).filter(k => !SHEET_KINDS.includes(k))];
  const sheets = kinds.map(kind => R.sheetOpen(signs, { kind, seed: seeds[kind], fields: fieldsOf(kind, seeds[kind]) }));
  // a move prepared, its lines under the quote
  const move = sheets[kinds.indexOf('move')];
  const prepared = R.sheetPrepared(move, { prepared: { ok: true, action: { type: 'liveMove', kind: 'transfer', from: 'ex', to: 'agent-claude-code', toAddress: '0xcd' }, shown: [{ name: 'Move', value: '10 USDC' }] }, at: NOW, asked: askedOf(move.sheet), deadline: NOW + 125_000 });
  // a market page's book, latest trades and funding: read, failed; a perpetual's funding with what it could not read
  const on = R.nav(R.statementLoaded(R.holdingsLoaded(R.accountLoaded(R.exploreLoaded(R.nav(emptyState(), { screen: 'markets', id: null }), { tab: 'all', data: fx('explore-all'), at: NOW }), { data: page, at: NOW }), { data: fx('holdings'), at: NOW }), { data: fx('statement'), at: NOW }), { screen: 'markets', id: 'coin:BTC' });
  const depth = (s, id, part, data) => R.depthLoaded(s, { id, part, data, at: NOW });
  const book = depth(depth(on, 'coin:BTC', 'book', fx('book')), 'coin:BTC', 'trades', fx('trades'));
  const perp = R.nav(on, { screen: 'markets', id: 'perp:BTC' });
  const funding = {
    ok: true, lines: [{ at: '2026-10-19T10:00:00.000Z', symbol: 'BTC/USDT:USDT', side: 'long', qty: 0.01, rate: 0.0001, usd: 0.06, venue: 'ex', venueName: 'Stand-in Exchange' }],
    missing: [{ venue: 'ex', venueName: 'Stand-in Exchange', why: 'no answer in time.', part: 'funding' }],
  };
  const markets = [
    book, R.depthFailed(R.depthFailed(on, { id: 'coin:BTC', part: 'book', at: NOW, message: 'the account layer is not mounted' }), { id: 'coin:BTC', part: 'trades', at: NOW }),
    depth(perp, 'perp:BTC', 'funding', funding), depth(perp, 'perp:BTC', 'funding', { ok: true, lines: [], missing: [] }), R.depthFailed(perp, { id: 'perp:BTC', part: 'funding', at: NOW }),
  ];
  const marketsOn = R.exploreLoaded(R.nav(emptyState(), { screen: 'markets', id: null }), { tab: 'all', data: fx('explore-all'), at: NOW });
  const watch = ['read', 'unsaved'].map(error => R.watchlistLoaded(marketsOn, { items: [], error }));
  return [...money, ...rules, ...sheets, prepared, ...markets, ...watch];
}
// the composer's states (plan 3 of the dsh UI port, Task 3): a / menu with headings and with a query, an @ menu with every kind,
// a folder walk with its crumb, in a conversation's composer; a draft with each chip kind in the editor; the operator's words
// with a conversation mention, a chip in the bubble (D17)
// a conversation's composer, each piece its own entry (composerPieces): a / menu with headings and with a query, an @ menu with
// every kind, a folder walk with its crumb; the operator's words with a conversation mention, a chip in the bubble (D17); a draft
// with each chip kind in the editor
function composerBuild() {
  const open = R.nav(R.hostList(emptyState(), { conversations: [conv('s1')], channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true, dir: '/r' }] }), { screen: 'messages', id: 's1' });
  const menus = [
    { kind: '/', from: 0, query: '', groups: slashItems({ commands: [{ name: 'compact', description: 'Shrink' }], skills: [{ name: 'rules', description: 'R' }], query: '', atStart: true }), active: 0 },
    { kind: '/', from: 0, query: 'r', groups: slashItems({ commands: [], skills: [{ name: 'rules' }], query: 'r', atStart: true }), active: 0 },
    { kind: '@', from: 0, query: '', active: 1, groups: atItems({ bots: [{ id: 'buffett', name: 'Buffett Type' }], files: [{ path: 'a/b.md', kind: 'file' }, { path: 'desk', kind: 'directory' }], conversations: [{ kind: 'conversation', id: 's7', title: 'Is BTC cheap?', age: 'Just now' }], query: '' }) },
    { kind: '@', from: 0, query: 'strategies/', active: 0, groups: atItems({ files: [{ path: 'strategies/alpha', kind: 'directory' }], query: 'strategies/' }) },
  ];
  const chips = [{ kind: 'bot', id: 'buffett', label: 'Buffett Type' }, { kind: 'file', path: 'a/b.md', dir: false, label: 'b.md' }, { kind: 'file', path: 'desk', dir: true, label: 'desk/' }, { kind: 'conversation', id: 's7', label: 'Is BTC cheap?' }];
  const mention = R.hostList(open, { conversations: [conv('s1', { messages: [m('y1', { from: 'you', text: `see @[Is BTC cheap?](${sessionUri('s7')})` })] })] });
  // the attachments (plan 4, Task 2): a rail with an image and a file in each state, a note above the box, the overlay, the lightbox
  const file = (key, over) => ({ key, kind: 'file', name: key + '.csv', bytes: 2048, mediaType: 'text/csv', status: 'ready', loaded: 0, ...over });
  const files = [{ ...file('i1'), kind: 'image', name: 'i.png', mediaType: 'image/png', url: 'blob:x' }, file('f1'), file('f2', { status: 'uploading', loaded: 1024 }), file('f3', { status: 'failed' }), file('f4', { status: 'up' })];
  const attached = renderMessagesScreen(open, NOW, { menu: null, files, note: 'Up to 20 images a message' }) + dropOverlay(DEFAULT_LIMITS) + lightboxHtml({ src: 'blob:x', name: 'i.png' });
  // attachments in history (plan 4, Task 3): a lone image loaded and loading, squares loaded and loading, an image the host
  // cannot give back, a file
  const img = (id, over = {}) => ({ type: 'image', attachmentId: id, mediaType: 'image/png', bytes: 2048, width: 4, height: 3, name: id + '.png', ...over });
  const sent = [[img('h1')], [img('h0')], [img('h1'), img('h0'), img('hx'), { type: 'file', attachmentId: 'hf', name: 'q3.csv', bytes: 2048 }]];
  const history = { ...R.hostWindow(open, { convId: 's1', messages: sent.map((attachments, i) => m('ya' + i, { from: 'you', text: i ? '' : 'look', data: { attachments } })) }), thumbs: { h1: 'data:image/png;base64,AA', hx: null } };
  // masking (plan 5, Task 2): two keys in the operator's words, the second revealed
  const sk = 'sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4';
  const masked = R.hostWindow(open, { convId: 's1', messages: [m('yk', { from: 'you', text: `${sk} and ${sk}x9` })] });
  const secrets = renderMessagesScreen(masked, NOW, {}, { revealed: new Set(['s1|yk|1']) });
  // the history window (plan 5, Task 4): the earlier key above a window with more before it
  const paging = renderMessagesScreen(R.hostWindow(open, { convId: 's1', messages: [m('yw', { seq: 30, from: 'you' })], window: { start: 30, through: 40, hasMore: true, replaced: [] } }), NOW);
  // the turn rail (plan 5, Task 7): a mark in the thread, a tick in each state, the hovered tick's card with its reply
  const outline = [1, 2, 3].map(turn => ({ turn, seq: turn * 10, prompt: 'ask ' + turn, response: 'reply ' + turn }));
  const railed = R.hostWindow(open, { convId: 's1', messages: [m('yr', { seq: 25, from: 'you' })], window: { start: 15, through: 40, hasMore: true, replaced: [] } });
  const rail = renderMessagesScreen({ ...railed, conversations: railed.conversations.map(c => ({ ...c, outline })) }, NOW, {}, { rail: { active: 2, hover: 2, pulse: 1 } });
  // background jobs (plan 5, Task 9): the chip live and finished; Details with a running job open, one asking Stop, one
  // stopping, and the finished fold with each end
  const job = (id, status, more = {}) => ({ id, kind: 'bash', label: 'run ' + id, owner: 's1', status, startedAt: NOW - 64_000, output: { total: 6, earliest: 0 }, ...more });
  const watched = rows => R.hostJobs(R.watchJobs(open, 's1'), { convId: 's1', jobs: rows });
  const jobRows = [job('j1', 'running', { progress: '3/10' }), job('j2', 'running'), job('j3', 'stopping'), job('f1', 'completed', { detail: 'exit code: 0', finishedAt: NOW }), job('f2', 'killed', { finishedAt: NOW }), job('f3', 'failed', { output: { total: 0, earliest: 0 }, finishedAt: NOW })];
  const jobsOn = R.toggleDetails(R.askConfirm(R.openJob(watched(jobRows), 'j1'), { action: 'stopJob', id: 'j2', conv: 's1' }));
  const jobsHtml = renderMessagesScreen(jobsOn, NOW) + renderMessagesScreen(watched([job('f1', 'completed', { finishedAt: NOW })]), NOW);
  const runs = [{ type: 'text', text: 'ask ' }, ...chips.map(chip => ({ type: 'chip', chip }))];
  const editor = editorHtml(runs);
  const pieces = [
    ...menus.map((menu, i) => [`menu-${i}`, renderMessagesScreen(open, NOW, { menu })]), ['mention', renderMessagesScreen(mention, NOW)], ['attached', attached],
    ['history', renderMessagesScreen(history, NOW)], ['secrets', secrets], ['paging', paging], ['rail', rail], ['jobs', jobsHtml], ['editor', editor],
  ];
  // what the pieces are drawn from, for corpusStrings
  const inputs = [open, menus, mention, files, 'Up to 20 images a message', DEFAULT_LIMITS, history, masked, railed, outline, jobsOn, jobRows, runs];
  return { pieces, inputs };
}
export const composerPieces = () => composerBuild().pieces;
export const screenOf = (st, now) => (st.route.screen === 'markets' ? renderMarketsScreen(st, now) : st.route.screen === 'account' ? renderAccountScreen(st, now)
  : st.route.screen === 'trade' ? renderTradeScreen(st, now)
  : st.route.screen === 'channel' ? renderChannelScreen(st, now) : st.route.screen === 'discover' ? renderDiscover(st, now)
  : st.route.screen === 'plugin' ? renderPlugin(st, now) : st.route.screen === 'module' ? renderModule(st, now) : renderMessagesScreen(st, now));

// a state's page as css.test.js draws it: the rail, the screen, then every drawer and sheet that may stand over it
export function pageHtml(st, { mac = true } = {}) {
  return renderRail(st, NOW, { mac }) + screenOf(st, NOW) + (st.settingsOpen ? renderSettings(st) : '') + stockDrawerHtml(st) + renderSellMany(st) +
    renderSheet(st, NOW) + renderConnectDrawer(st) + renderRunSheet(st, NOW);
}

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

// lines a host writes into the store from its own source, drawn as the page would: a module card's Run that could not send
// (host/run-sheet.js); an Answer pressed with a question unanswered (app.js). The states come from running the host, so a
// word moved there shows here
export async function hostCorpus() {
  const entries = [];
  {
    const store = createStore({ initial: R.nav(emptyState(), { screen: 'discover', id: null }), reducers: R });
    const sheet = startRunSheet({ store, actions: { newConversation: async () => null }, readListing: async () => modulesListing(), go: () => {}, now: () => NOW });
    await sheet.open('theme');
    await sheet.run();
    entries.push(['host-run-sheet-failed', renderRunSheet(store.get(), NOW)]);
  }
  {
    const f = fakeWindow({ hash: '' });
    let opts = null;
    const mux = { stream: () => ({ cancel() {} }), answer: async () => {}, close() {} };
    const rows = [{ sessionId: 's1', updatedAt: 5, agentAvailable: false, running: false, blank: false }];
    const call = async endpoint => (endpoint === 'session/list' ? { items: rows } : endpoint === 'session/projections' ? { asOfSeq: 20, values: {} } : endpoint === 'session/page' ? { records: [] } : undefined);
    const getJson = async path => (path === '/data/channels.json' ? { ok: true, root: '/r', channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true, sessionIds: [] }], ungrouped: [], archived: [], presets: {} }
      : path === '/data/sessions-meta.json' ? { ok: true, archived: [], deleted: [] } : { ok: true, bots: [] });
    const store = boot(f.win, { editor: valueEditor, openMux: o => { opts = o; return mux; }, call, getJson, postJson: async () => ({ ok: true }), markdown: null, now: () => NOW });
    try {
      await settle();
      opts.onReady({});
      await settle();
      opts.onGate({ type: 'waterfall', event: 'user-questions/request', eventId: 'ev-2', agentId: 's1', request: { questions: [{ id: 'q1', question: 'Pin the paper account?', header: 'Gate 2', options: [{ label: 'Yes' }] }] } });
      await settle();
      f.click({ tagName: 'BUTTON', dataset: { action: 'answerQuestion', conv: 's1', msg: 'ev-2' } });
      await settle();
      entries.push(['host-app-answer-first', pageHtml(store.get())]);
    } finally {
      store.timers.clear();
    }
  }
  return entries;
}

// every entry the golden pins: the corpus, then the host-written lines
export async function goldenEntries() {
  return [...corpus(), ...await hostCorpus()];
}

// the corpus, named and in order: every state, again off a Mac when it draws the list (whose search key names the chord), then
// the composer's pieces; the markdown renderer unset, as the screens draw with it
export function corpus() {
  setMarkdown(null);
  const states = everyState().flatMap((st, i) => [[`state-${i}`, pageHtml(st)], ...(renderList(st, NOW) ? [[`state-${i}-pc`, pageHtml(st, { mac: false })]] : [])]);
  return [...states, ...composerPieces().map(([name, html]) => [`composer-${name}`, html])];
}

// the keys whose strings are codes a screen compares, not words it draws (a status, a kind, a side…): their values are left out
// of corpusStrings, so a code word drawn as a word (killed, failed, running) is the probe's to find
const CODE_KEYS = new Set(['status', 'kind', 'state', 'phase', 'mode', 'side', 'type', 'quote_status', 'market_status']);
// the parts of a state that are an upstream's content as a whole, drawn as they come — a run's view and its artifacts
// (Lunhui's output), a strategy's files (Gravit's): every string in them counts, its keys too (a metric's name)
const CONTENT = [['lunhui', 'views'], ['discover', 'shelves', 'modules', 'data'], ['channel', 'data']];

// every string the corpus' own states, the composer pieces' inputs and the module catalog (its codes, sub-titles, roles and
// rulings' citations: content, spec §5.10) hold, but those under a code key outside the content: the words a screen may draw
// that are not the face's (words-probe.test.js)
export function corpusStrings() {
  const out = [];
  const seen = new Set();
  const walk = (v, key, path, content) => {
    if (typeof v === 'string') { if (content || !CODE_KEYS.has(key)) out.push(v); return; }
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v instanceof Map) { for (const [k, x] of v) { walk(k, null, path, content); walk(x, typeof k === 'string' ? k : null, path, content); } return; }
    if (v instanceof Set || Array.isArray(v)) { for (const x of v) walk(x, key, path, content); return; }
    for (const [k, x] of Object.entries(v)) {
      const at = [...path, k];
      const inside = content || CONTENT.some(c => c.length === at.length && c.every((p, i) => p === at[i]));
      if (inside === true) out.push(k);
      walk(x, k, at, inside);
    }
  };
  for (const st of everyState()) walk(st, null, [], false);
  walk(composerBuild().inputs, null, [], false);
  walk(MODULES, null, [], 'values'); // its values, not its keys
  return out;
}
