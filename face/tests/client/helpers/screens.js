// The screen corpus: every state css.test.js draws, named, so a test can hold each screen to its bytes (words-golden.test.js)
// or to its classes (css.test.js). Paths below resolve from tests/client/helpers/.
import { readFileSync } from 'node:fs';
import { renderRail } from '../../../client/js/render/rail.js';
import { renderSide } from '../../../client/js/render/side.js';
import { renderMessagesScreen } from '../../../client/js/render/messages.js';
import { renderTaskScreen } from '../../../client/js/render/task.js';
import { renderHistoryScreen } from '../../../client/js/render/history.js';
import { renderMarketsScreen } from '../../../client/js/render/markets.js';
import { renderSettings, renderAccountScreen, renderSellMany } from '../../../client/js/render/account.js';
import { renderSheet } from '../../../client/js/render/owner.js';
import { renderShortcuts } from '../../../client/js/render/shortcuts.js';
import { renderConnectDrawer } from '../../../client/js/render/identity.js';
import { renderTradeScreen } from '../../../client/js/render/trade.js';
import { ticketOf } from '../../../client/js/host/trade-view.js';
import { fieldsOf } from '../../../client/js/host/sheet-view.js';
import { askedOf } from '../../../client/js/host/sheet.js';
import { renderStrategyScreen } from '../../../client/js/render/strategy.js';
import { renderDiscover, renderPlugin } from '../../../client/js/render/discover.js';
import { renderModule } from '../../../client/js/render/modules.js';
import { renderRunSheet } from '../../../client/js/render/run-sheet.js';
import { newSheet } from '../../../client/js/host/run-sheet-view.js';
import { MODULES } from '../../../client/js/host/modules-view.js';
import { t } from '../../../client/js/i18n/words.js';
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
import { SHEET_KINDS, letDeviceSeedOf, removeDeviceSeedOf, paperSeedOf, signOutSeedOf } from '../../../client/js/host/sheet-view.js';
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
  const on = R.setMarketsScope(R.nav(emptyState(), { screen: 'markets', id: null }), 'more');
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
  const seated = seatedOf(read);
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

const seatedOf = read => R.seatLoaded(read, { data: { ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-19T14:00:00Z', mode: 'guard', writes: { on: true, capUsd: 100 }, seat: { name: 'Gravit', status: 'admitted', address: '0xab12', limits: [] }, venues: [], cards: [] }, at: NOW });

// Account › Identity's read on a page that signs: Telegram connected and failing to poll, a stranger, quiet hours
function identitySigning(base) {
  const read = {
    ok: true, networks: [{ network: 'telegram', speaksAs: '@gravit_desk_bot', talksOnlyWith: '@pan', since: '2026-11-03T15:20:00.000Z', fingerprint: 'ab12cd34', state: 'connected', polling: false, pollFailing: { since: '2026-11-04T14:00:00.000Z', reason: 'ENOTFOUND' } }],
    routing: { chat: ['telegram'], alerts: [], brief: [], cards: [], fills: [] }, quiet: { from: '23:00', to: '07:00', zone: 'America/New_York' },
    strangers: [{ network: 'telegram', sender: '0123456789ab', masked: '…789', count: 3, last: '2026-11-04T13:02:00.000Z' }],
  };
  return R.ownerStanding(R.identityLoaded(base, read), { role: 'signs', kid: 'a5048199a8081854' });
}

function identityStates(base) {
  const signing = identitySigning(base);
  return [
    R.identityTick(R.identityDetails(signing), { row: 'brief', network: 'telegram', on: true }),
    R.identityLoaded(base, { ok: true, networks: [], routing: {}, quiet: null, strangers: [] }),
    R.identityFailed(base, 'The account did not answer.'),
    // Connect Telegram (Task 2): sheets 1 to 3 in the drawer (2 with its QR and a conflict, 3 refused with Start again), and (where
    // sheet 4, the owner sheet, stood until sign-only-money) the Identity tab after This is me connected
    ...connectStates(signing),
  ];
}

function connectStates(signing) {
  const pending = { id: '0123456789abcdef0123456789abcdef', network: 'telegram', bot: { id: '777', username: 'gravit_desk_bot', name: 'Gravit' }, link: 'https://t.me/gravit_desk_bot', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'conflict' };
  const heard = { ...pending, state: 'heard', sender: { id: '555000123', name: 'Pan', handle: '@pan', masked: '…123', text: '/start' } };
  const open = R.identityConnectOpen(signing);
  return [
    R.identityConnectSet(open, { busy: true, error: t('identity.connect.empty') }),
    R.identityConnectSet(open, { step: 2, pending }),
    R.identityConnectSet(open, { step: 3, pending: heard, error: 'This connection is gone: it expired or was closed. Start again.' }),
    R.identityConnectClose(R.identityConnectSet(open, { step: 3, pending: heard })),
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
    const tk = ticketOf(on, NOW);
    return R.sheetOpen(on, { kind: 'order', seed: { id: open.id, ticket: tk }, fields: { venue: tk.venue, side: tk.side, outcome: String(tk.outcome), amount: '', unit: 'usd', orderType: 'market', limit: '', extendedHours: false, ...fields } });
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

// Messages with `id` the conversation /data/tasks names (plan 2 of one entry)
export const onConv = (s, id) => R.nav(R.tasksLoaded(s, { conversation: id, tasks: [], at: NOW }), { screen: 'messages', id: null });

// a strategy's page: loaded with every section, loading, unavailable, stale after a failed re-read, not found (listed or after
// a failed list read); its tasks, one open; its paper positions — no venue named, being read, read, none open, refused, failed
function strategyStates() {
  const alpha = { workspaceId: 'w1', name: 'alpha', title: 'Alpha', dir: '/r/strategies/alpha', isRoot: false, missingDir: false, sessionIds: [] };
  const on = R.nav(R.hostList(emptyState(), { conversations: [conv('c1', { channel: { workspaceId: 'w1', name: 'alpha' } })], channels: [alpha] }), { screen: 'strategy', id: 'alpha' });
  const data = {
    ok: true, channel: alpha, status: { status: 'researching', one_line: 'Holds', next: 'Rerun', numbers: { sharpe: '1.4' } },
    body: { thesis: { markdown: '# A', isTemplate: false }, journal: [{ date: '2026-10-19', text: 'Ran' }], backtests: [{ file: 'b.json', bytes: 9 }], latest: { file: 'b.json', json: { sharpe: 1.4 } }, files: [{ name: 'n.md', bytes: 9, mtime: '2026-10-19T09:00:00.000Z' }] },
  };
  const loaded = R.channelLoaded(on, { workspaceId: 'w1', data, at: NOW });
  const task = (id, over) => ({ id, title: `Size the hedge ${id}`, origin: 'web', state: 'running', group: 'running', steps: ['Read the book'], startedAt: NOW - 3 * MIN, lastEventAt: NOW, lastSeq: 1, strategy: 'alpha', ...over });
  const tasked = R.tasksLoaded(loaded, { conversation: 'c1', tasks: [task('t1'), task('t2', { state: 'done', group: 'done', result: { text: 'Hedged a third' } }), task('t3', { strategy: 'beta' })], at: NOW });
  const venued = R.channelLoaded(on, { workspaceId: 'w1', data: { ...data, status: { ...data.status, venue: 'paper-us' } }, at: NOW });
  const asked = R.channelPositionsLoading(venued, { workspaceId: 'w1', venue: 'paper-us' });
  const rows = [
    { venue: 'paper-us', venueName: 'Paper US', symbol: 'NVDA', name: 'NVIDIA', side: 'long', qty: 12, entryPrice: 120.5, markPrice: 131.25, usd: 1575, unrealizedUsd: 129, paper: true, kind: 'stock', leverage: null },
    { venue: 'paper-us', venueName: 'Paper US', symbol: 'TSLA', name: 'Tesla', side: 'short', qty: 3, entryPrice: 250, markPrice: 262, usd: 786, unrealizedUsd: -36, paper: true, kind: 'stock', leverage: null },
  ];
  return [
    loaded, R.channelLoading(on, { workspaceId: 'w1' }), R.channelFailed(on, { workspaceId: 'w1', at: NOW }), R.channelFailed(loaded, { workspaceId: 'w1', at: NOW }), R.nav(on, { screen: 'strategy', id: 'w9' }),
    R.hostListFailed(R.nav(emptyState(), { screen: 'strategy', id: 'w9' })),
    tasked, R.tasksLoaded(loaded, { conversation: 'c1', tasks: [task('t3', { strategy: 'beta' })], at: NOW }),
    asked, R.channelPositionsLoaded(asked, { workspaceId: 'w1', venue: 'paper-us', rows }), R.channelPositionsLoaded(asked, { workspaceId: 'w1', venue: 'paper-us', rows: [] }),
    R.channelPositionsFailed(asked, { workspaceId: 'w1', venue: 'paper-us', message: 'paper-us is not a paper venue' }), R.channelPositionsFailed(asked, { workspaceId: 'w1', venue: 'paper-us' }),
  ];
}

// Discover: the shelves, a failed shelf, a query, a shelf's grid, every kind of page, its own line
// the task Gravit started for a Run of Theme, as GET /data/tasks shows it
const runTask = { id: 't-run', title: 'Theme · 10-19', origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW, lastEventAt: NOW, lastSeq: 1 };

export function discoverStates() {
  let all = emptyState();
  for (const [shelf, v] of Object.entries(listings())) all = R.shelfLoaded(all, { shelf, data: v.data, at: 1 });
  all = R.shelfLoaded(all, { shelf: 'modules', data: modulesListing(), at: 1 });
  const at = route => R.nav(all, route);
  const page = id => at({ screen: 'plugin', id });
  const unmounted = R.shelfLoaded(at({ screen: 'discover', id: null }), { shelf: 'modules', data: { ...modulesListing(), mounted: false }, at: 2 });
  return [
    unmounted, at({ screen: 'discover', id: 'research' }),
    // a card whose Run was sent to Gravit (one-entry plan 2): before its task shows, Sent linking to Messages; once Gravit
    // started the task of the Run's title, Running linking to the task
    R.moduleRunStarted(at({ screen: 'discover', id: 'research' }), { module: 'theme', title: 'Theme · 10-19', startedAt: NOW }),
    R.tasksLoaded(R.moduleRunStarted(at({ screen: 'discover', id: 'research' }), { module: 'theme', title: 'Theme · 10-19', startedAt: NOW }), { conversation: 'c-gravit', tasks: [runTask], at: NOW }),
    R.tasksLoaded(R.moduleRunStarted(at({ screen: 'module', id: 'theme' }), { module: 'theme', title: 'Theme · 10-19', startedAt: NOW }), { conversation: 'c-gravit', tasks: [runTask], at: NOW }),
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

// the side panel's search (plan 2 of the dsh UI port): searching, nothing found, failed, results with a marked snippet, an
// archived hit and the more-than-twenty line
export function searchStates(s) {
  const q = (q, then) => { const st = R.setSearchQuery(s, q); return then ? then(st, q) : st; };
  return [
    q('zz'), q('zz', (st, query) => R.searchContent(st, { query, items: [], hasMore: false })), q('zz', (st, query) => R.searchFailed(st, { query })),
    q('T', (st, query) => R.searchContent(st, { query, items: [{ sessionId: 's1', snippet: 'a T b', match: [2, 3] }], hasMore: true })),
  ];
}

// the states stage 1 can show: loading, a conversation with every kind, a group thinking, Details, the task kinds, Settings, the
// conversation off and loading, a bad status, the rail folded
export function everyState() {
  const base = R.hostList(emptyState(), { conversations: [conv('s1', { messages: KINDS, running: true, usage: { tokenUsage: { outputTokens: 1 }, contextPressure: 0.5 }, stats: { turns: 1, steps: 2, llmMs: 900, toolMs: 0, ttftMs: 300, ttftSteps: 2, decodeMs: 500, decodeTokens: 20 }, created: NOW }), conv('g', { kind: 'group', members: ['gravit', 'buffett'], thinking: 'text', messages: [m('g1', { from: 'buffett', text: 'hold', data: { name: 'Buffett Type', markdown: true, memberSessionId: 'm1', memberTurn: 2 } })] })], channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true }, { workspaceId: 'w-cn', name: 'cn-market', isRoot: false, status: 'researching' }], bots: [{ id: 'buffett', name: 'Buffett Type' }] });
  const open = onConv(base, 's1');
  return [
    emptyState(), open, lunhuiStates(open), ...stockStates(open), lunhuiStates(open, { 's1-p1': { tile: 'environment', breadth: 'dist' } }), onConv(base, 'g'), R.toggleDetails(open), R.askConfirm(R.toggleDetails(open), { action: 'stopGravit', id: 's1' }),
    // (where the rename editor, New message and its New channel… stood: one-entry plan 2 Task 5 drew them away) the task kinds,
    // the conversation off, and its tasks loading
    taskKindStates(base), R.openSettings(open), R.tasksOff(open, { at: NOW }),
    R.nav(R.hostList(emptyState(), { conversations: base.conversations, channels: base.channels }), { screen: 'messages', id: null }),
    R.hostStatus(open, { line: 'Reconnecting…', bad: true }), R.toggleRail(open),
    ...searchStates(R.hostList(open, { conversations: [...open.conversations, conv('old', { title: 'T old', archived: 'face' })] })), // (where the pinned row stood: one-entry plan 2 Task 6) the side panel beside a strategy's page, Gravit's dot on
    R.nav(R.hostList(open, { conversations: open.conversations.map(c => (c.id === 's1' ? { ...c, updatedAt: NOW + MIN } : c)) }), { screen: 'strategy', id: 'cn-market' }),
    R.traceLoaded(onConv(base, 'g'), { convId: 'g', msgId: 'g1', messages: [m('tg1', { kind: 'tool', text: 'account', data: { callId: 'g1c', name: 'mcp__alpaca-kit__account', result: JSON.stringify({ ok: true, equity: '1' }) } }), m('tg2', { from: 'system', text: 'context' })] }),
    R.toggleDetails(R.hostList(R.hostProjection(open, { convId: 's1', key: 'subagentCatalog', value: [{ id: 'k1', createdAt: 1, mode: 'continuable', label: 'Check' }, { id: 'k2', createdAt: 2, mode: 'unknown' }] }), { conversations: open.conversations, childRows: [{ sessionId: 'k1', parentSessionId: 's1', running: true, origin: 'subagent' }] })), ...marketStates(), ...accountStates(), ...strategyStates(), ...discoverStates(), ...tradeStates(),
    // the golden is append-only (golden-write.js): a state added later goes after these, so every pinned name keeps its state
    ...laterStates(),
    ...shortcutStates(open),
    // Slack in Account › Identity (plan B2 Task 7), merged from main after plan 6
    ...slackStates(identitySigning(R.nav(seatedOf(accountRead()), { screen: 'account', tab: 'identity' }))),
    // Settings › Language (plan 7 Task 9) pressed on 中文; the Settings states under ZH are screens-zh.json's (Task 10)
    R.setLang(R.openSettings(open), 'zh'),
    ...focusedMarketStates(),
    ...providerMarketStates(),
    // plan 2 of one entry, Task 3: a task's page, history and its list, and an old link waiting on the tasks
    ...sessionPageStates(base),
    // plan 2 of one entry, Task 4: the rail of tasks on Messages
    ...taskRailStates(base),
    // plan 2 of one entry, Task 5: the conversation known but not listed yet (its empty state, the rail beside it), and the
    // tasks' first read failed
    R.tasksLoaded(onConv(base, 'fresh'), { conversation: 'fresh', tasks: [{ id: 'ru', title: 'Price the basket', origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 3 * MIN, lastEventAt: NOW - MIN, lastSeq: 1 }], at: NOW }),
    R.tasksFailed(R.nav(R.hostList(emptyState(), { conversations: base.conversations, channels: base.channels }), { screen: 'messages', id: null }), { at: NOW }),
    // plan 2 of one entry, Task 7: History's rows with a strategy and a preview, and one session read-only with its gates closed
    ...historyStates(base),
    // plan 2 of one entry, Task 8: a task's full process
    ...taskPageStates(base),
    // the final review's fixes: a waiting line whose gate this page has not seen yet (after a reload) points at its full process
    R.nav(R.tasksLoaded(R.hostList(base, { conversations: [...base.conversations, conv('wr', { title: 'Buy back the hedge' })] }), { conversation: 's1', tasks: [{ id: 'wr', title: 'Buy back the hedge', origin: 'web', state: 'waiting', group: 'you', steps: [], startedAt: NOW - 3 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, waitingFor: { kind: 'approval', id: 'c9', tool: 'mcp__account__portfolio_place_order' } }], at: NOW }), { screen: 'messages', id: null }),
    // plan 3 of one entry, Task 7: the desk in the conversation - a phone text from each network and one naming none, a
    // schedule line, an alert line, and a line with no body
    deskFoldState(base),
    // plan 3 of one entry, Task 8: the rail's desk lines and its scheduled group, a phone task naming its origin, and a
    // strategy's page listing its standing order
    ...deskRailStates(base),
    // iMessage in Account › Identity (the iMessage plan), appended after the states above (after one entry's plan 3 since the merge)
    ...imessageStates(identitySigning(R.nav(seatedOf(accountRead()), { screen: 'account', tab: 'identity' }))),
    // plan 4 of one entry, Task 5: Available to Gravit on, off and unreadable, and a bot task's line on the rail
    ...rosterStates(base),
    // sign-only-money Task 5: Identity on a page that does not sign — This is me refused on Slack's sheet 3, quiet hours' clocks open
    // with the account's refusal under them, Block's refusal in Not you
    ...unsignedIdentityStates(R.nav(seatedOf(accountRead()), { screen: 'account', tab: 'identity' })),
    // sign-only-money Task 7: a browser that does not sign with Get a code, then asked with the code box; Settings › Devices with
    // how each signer came in and Remove; the removeDevice sheet
    ...deviceStates(accountRead()),
  ];
}

// Get a code and Settings › Devices (sign-only-money Task 7)
function deviceStates(read) {
  const KID = 'a5048199a8081854';
  const page = { ...read.account.data, signers: { ...read.account.data.signers, owners: [
    { id: `device:${KID}`, kind: 'device', label: 'Gravit face', via: 'first', addedAt: '2026-11-01T14:05:00.000Z' },
    { id: 'device:0f0f0f0f0f0f0f0f', kind: 'device', label: 'Laptop', via: 'letIn', by: `device:${KID}`, addedAt: '2026-11-02T15:30:00.000Z' },
    { id: 'device:1234123412341234', kind: 'device', label: 'Phone', via: 'code', addedAt: '2026-11-09T21:10:00.000Z' },
  ], pendingDevices: [{ kid: 'fedcba9876543210', at: '2026-11-09T21:00:00.000Z' }] } };
  const signs = R.ownerStanding(R.accountLoaded(read, { data: page, at: NOW }), { role: 'signs', kid: KID });
  const seed = removeDeviceSeedOf(page, signs.owner, 'device:1234123412341234');
  return [
    R.ownerStanding(read, { role: 'pending', kid: 'fedcba9876543210' }), R.ownerStanding(read, { role: 'asked', kid: 'fedcba9876543210' }),
    R.openSettings(signs),
    R.sheetOpen(signs, { kind: 'removeDevice', seed, fields: fieldsOf('removeDevice', seed) }),
  ];
}

// Identity with no signature (sign-only-money Task 5): the read of identitySigning on a page that does not sign
function unsignedIdentityStates(base) {
  const read = identitySigning(base).identity.data;
  const page = R.ownerStanding(R.identityLoaded(base, read), { role: 'needs-code', kid: '' });
  const pending = { id: 'fedcba9876543210fedcba9876543210', network: 'slack', bot: { id: 'T0FAKE001:U0BOT0001', username: 'gravit', name: 'Gravit' }, workspace: 'Fake Co', link: 'https://slack.com/app_redirect?app=A0FAKE0001&team=T0FAKE001', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'heard', sender: { id: 'T0FAKE001:U0OPER7QK', name: 'Pan', handle: '@pan', userId: 'U0OPER7QK', masked: '…7QK', text: 'hi' } };
  return [
    R.identityConnectSet(R.identityConnectOpen(page, 'slack'), { step: 3, pending, error: 'This connection is gone: it expired or was closed. Start again.' }),
    R.identitySaid(R.identityQuietEdit(page, true), { at: 'quiet', words: 'Quiet hours start and end at different times' }),
    R.identitySaid(page, { at: 'strangers', words: 'That sender is blocked already' }),
  ];
}

// the one roster (one-entry plan 4 Task 5): a bot's page and a connected CLI agent's with the switch on, off, and the roster
// file unreadable (the switches disabled under its line); then a bot task's rail line beside a Gravit task's
function rosterStates(base) {
  let all = emptyState();
  for (const [shelf, v] of Object.entries(listings())) all = R.shelfLoaded(all, { shelf, data: v.data, at: 1 });
  const page = (id, roster) => R.rosterLoaded(R.nav(all, { screen: 'plugin', id }), roster);
  const on = { ok: true, agents: ['codex'], bots: ['buffett'] };
  const off = { ok: true, agents: [], bots: [] };
  const bad = { ok: false, corrupt: true };
  const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 12 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, ...over });
  const tasks = [task('bb', { title: 'Argue the bull case', bot: 'drill-bull' }), task('gg', { title: 'Price the basket' })];
  return [
    page('bot:buffett', on), page('agent:codex', on), page('bot:buffett', off), page('agent:codex', off), page('bot:buffett', bad), page('agent:codex', bad),
    R.nav(R.tasksLoaded(base, { conversation: 's1', tasks, at: NOW }), { screen: 'messages', id: null }),
  ];
}

// the desk folded into the conversation (one-entry plan 3 Task 7): the operator's phone texts under their chip, and the
// face's firings and alerts as centred lines under theirs
function deskFoldState(base) {
  const messages = [
    m('d1', { from: 'you', text: 'NVDA now?', seq: 1, data: { source: 'telegram', network: 'telegram' } }),
    m('d2', { from: 'system', kind: 'desk', text: 'Check the book before the close.\nName what moved.', seq: 2, data: { line: 'schedule', order: 'preclose', firing: 'preclose:2026-11-09', date: '2026-11-09' } }),
    m('d3', { from: 'system', kind: 'desk', text: 'NVDA fell 6% on guidance', seq: 3, data: { line: 'alert', alert: 'a-1', symbol: 'NVDA' } }),
    m('d4', { from: 'you', text: 'sell half', seq: 4, data: { source: 'telegram', network: 'slack' } }),
    m('d5', { from: 'you', text: 'and the rest?', seq: 5, data: { source: 'telegram' } }),
    m('d6', { from: 'system', kind: 'desk', text: '', seq: 6, data: { line: 'alert' } }),
  ];
  return R.tasksLoaded(R.nav(R.hostList(base, { conversations: [...base.conversations, conv('dk', { messages, loaded: true })] }), { screen: 'messages', id: null }), { conversation: 'dk', tasks: [], at: NOW });
}

// a task's full process (one-entry plan 2 Task 8): a running worker with its strategy, a brief, an answer with follow-ups and
// an approval still open (answerable here), the stock drawer open over it; one stalled with Stop and Continue busy and Details
// on its jobs; one done (no keys); one whose transcript the list does not carry yet
function taskPageStates(base) {
  const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 12 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, ...over });
  const messages = [
    m('wb', { from: 'system', kind: 'task', text: 'Read the tape\n\nPrice the leaders', seq: 1, data: { form: 'brief' } }),
    m('wp', { kind: 'composed', text: '弱势日', seq: 2, data: { callId: 'w', strategy: 'cn-market', run: 'loaded', summary: '弱势日', blocks: [{ kind: 'ladder' }], choices: [{ label: 'Look again at the leaders' }], modules: [] } }),
    m('wa', { kind: 'approval', text: 'run it', seq: 3, data: { eventId: 'wa', sessionId: 'wk', toolName: 'bash', reason: 'reads the tape' } }),
  ];
  const workers = [conv('wk', { title: 'Read the tape', messages, loaded: true, live: true }), conv('ws', { title: 'Scan filings', loaded: true, messages: [m('ws1', { text: 'Opened EDGAR' })] }), conv('wd', { title: 'Morning read', loaded: true })];
  const tasks = [task('wk', { title: 'Read the tape', strategy: 'cn-market', steps: ['Read quotes'] }), task('ws', { title: 'Scan filings', state: 'stalled', group: 'you' }), task('wd', { title: 'Morning read', state: 'done', group: 'done' }), task('wn', { title: 'Fresh one' })];
  const on = R.tasksLoaded(R.hostList(base, { conversations: [...base.conversations, ...workers] }), { conversation: 's1', tasks, at: NOW });
  const opened = R.nav(on, { screen: 'task', id: 'wk' });
  const read = { ...opened, lunhui: { ...opened.lunhui, views: { 'cn-market/loaded/': { status: 'loaded', view: VIEW_1027 } }, ui: {}, stock: { key: 'cn-market/loaded/', code: '600001' } } };
  const job = { id: 'wj', kind: 'bash', label: 'fetch filings', owner: 'ws', status: 'running', startedAt: NOW - 64_000, output: { total: 6, earliest: 0 } };
  const stalled = R.toggleDetails(R.taskBusy(R.hostJobs(R.watchJobs(R.nav(on, { screen: 'task', id: 'ws' }), 'ws'), { convId: 'ws', jobs: [job] }), { id: 'ws', on: true }));
  return [read, stalled, R.nav(on, { screen: 'task', id: 'wd' }), R.nav(on, { screen: 'task', id: 'wn' })];
}

// History (one-entry plan 2 Task 7): rows naming a strategy, with a preview and without; one session opened read-only, an
// approval and a question still open in its record drawn closed, an answered card, earlier pages to load, one loading them
function historyStates(base) {
  const gates = [
    m('h1', { from: 'you', text: 'Price the basket', seq: 1, at: NOW - 9 * MIN }),
    m('h2', { kind: 'approval', text: 'run it', seq: 2, data: { eventId: 'h2', sessionId: 'old', toolName: 'bash', reason: 'reads the tape' } }),
    m('h3', { kind: 'question', text: '', seq: 3, data: { eventId: 'h3', sessionId: 'old', questions: [{ id: 'q1', header: 'Venue', question: 'Which paper venue?', options: [{ label: 'Paper US' }] }] } }),
    m('h4', { kind: 'card', text: 'Buy 2 NVDA', seq: 4, answer: 'approved', data: { eventId: 'h4', sessionId: 'old', title: 'Buy 2 NVDA', venue: 'paper', line: 'limit 120' } }),
  ];
  const old = conv('old', { title: 'Last week', channel: { workspaceId: 'w-cn', name: 'cn-market' }, preview: 'Held the line\nsold half', updatedAt: NOW - 2 * MIN, messages: gates, loaded: true, window: { start: 1, through: 4, hasMore: true } });
  const quiet = conv('quiet', { title: 'A quiet one', channel: { workspaceId: 'w0', name: 'workbench' }, updatedAt: NOW - 3 * 24 * 60 * MIN });
  const listed = R.tasksLoaded(R.hostList(base, { conversations: [...base.conversations, old, quiet] }), { conversation: 's1', tasks: [], at: NOW });
  const loading = R.hostEarlierLoading(R.nav(listed, { screen: 'history', id: 'old' }), { convId: 'old', on: true });
  return [R.nav(listed, { screen: 'history', id: null }), R.nav(listed, { screen: 'history', id: 'old' }), loading];
}

// the task source kind (one-entry plan 2 Task 5): a report relayed into the conversation (its title read, and one unread named
// by the tasks slice), a worker's brief and a steer Gravit relayed, a recovery note, a stop
function taskKindStates(base) {
  const k = (id, form, text, data = {}) => m(id, { from: 'system', kind: 'task', text, data: { form, ...data } });
  const messages = [
    k('k1', 'report', '[task · Read the tape · ready]', { task: 'rt', status: 'ready', title: 'Read the tape', body: 'Held the line; sold half' }),
    k('k2', 'report', 'no head', { task: 'sf', status: 'blocked', title: null, body: 'No paper venue is granted' }),
    k('k3', 'brief', 'Scan filings\n\nRead the 10-Q'), k('k4', 'steer', 'Carry on with the second filing'),
    k('k5', 'recovery', 'The face restarted while you worked.'), k('k6', 'stopped', 'Stopped by the conversation.'),
  ];
  const listed = R.hostList(base, { conversations: [...base.conversations, conv('tk', { messages, loaded: true })] });
  return R.tasksLoaded(R.nav(listed, { screen: 'messages', id: null }), { conversation: 'tk', tasks: [{ id: 'sf', title: 'Scan filings', origin: 'web', state: 'blocked', group: 'you', steps: [], startedAt: NOW, lastEventAt: NOW, lastSeq: 1 }], at: NOW });
}

// the rail of tasks under Messages' head: a line in every state — a worker's order card and a question waiting on it, one
// stalled with Stop and Continue busy, one blocked and one failed with their results, one running with its strategy and
// steps, one done with its tokens, one stopped — and a rail of running lines alone
function taskRailStates(base) {
  const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 12 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, ...over });
  const usage = { uncachedInputTokens: 1200, cacheReadTokens: 300, outputTokens: 80, cacheWriteTokens: 0, routes: [] };
  const tasks = [
    task('w1', { title: 'Buy a little NVDA', state: 'waiting', group: 'you', strategy: 'cn-market', steps: ['Read the tape'], waitingFor: { kind: 'approval', id: 'c1', tool: 'mcp__account__portfolio_place_order' } }),
    task('w2', { title: 'Pick a venue', state: 'waiting', group: 'you', waitingFor: { kind: 'question', id: 'c2', tool: 'ask_user_question' } }),
    task('st', { title: 'Scan filings', state: 'stalled', group: 'you', steps: ['Opened EDGAR'] }),
    task('bl', { title: 'Hedge the book', state: 'blocked', group: 'you', result: { status: 'blocked', text: 'No paper venue is granted' } }),
    task('fa', { title: 'Read the brief', state: 'failed', group: 'you', result: { status: 'failed', text: 'The market did not answer' } }),
    task('ru', { title: 'Price the basket', strategy: 'cn-market', steps: ['Read quotes', 'Priced three'] }),
    task('dn', { title: 'Morning read', state: 'done', group: 'done', result: { status: 'ready', text: 'Nothing to do today' }, usage }),
    task('sp', { title: 'Old idea', state: 'stopped', group: 'done' }),
  ];
  const workers = [conv('w1', { title: 'Buy a little NVDA' }), conv('w2', { title: 'Pick a venue' })];
  let on = R.tasksLoaded(R.hostList(base, { conversations: [...base.conversations, ...workers] }), { conversation: 's1', tasks, at: NOW });
  on = R.hostGate(on, { convId: 'w1', message: m('gw1', { kind: 'card', text: 'Buy 2 NVDA', seq: 1.5, data: { eventId: 'gw1', sessionId: 'w1', title: 'Buy 2 NVDA', venue: 'paper', line: 'limit 120' } }) });
  on = R.hostGate(on, { convId: 'w2', message: m('gw2', { kind: 'question', text: '', seq: 1.5, data: { eventId: 'gw2', sessionId: 'w2', questions: [{ id: 'q1', header: 'Venue', question: 'Which paper venue?', options: [{ label: 'Paper US' }] }] } }) });
  on = R.taskBusy(R.nav(on, { screen: 'messages', id: null }), { id: 'st', on: true });
  const running = R.nav(R.tasksLoaded(base, { conversation: 's1', tasks: [task('ru', { title: 'Price the basket' })], at: NOW }), { screen: 'messages', id: null });
  return [on, running];
}

// the desk folds into the rail (one-entry plan 3 Task 8): a task from each network's phone; a firing running, one done with
// its session, one failed, an annotation with its text; the standing orders armed with a next firing, a last outcome and a
// strategy, armed with none next, disabled and expired; then the scheduled group alone; then a strategy's page with its order
function deskRailStates(base) {
  const iso = ms => new Date(ms).toISOString();
  const task = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 12 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, ...over });
  const tasks = [task('ph', { title: 'Why did NVDA fall', origin: 'phone', network: 'telegram' }), task('sl', { title: 'Size the hedge', origin: 'phone', network: 'slack', state: 'done', group: 'done' })];
  const desk = {
    scheduled: [
      { order: 'pre-close', strategy: 'cn-market', next: iso(NOW + 60 * MIN), last: { outcome: 'finished', t: iso(NOW - 24 * 60 * MIN), sessionId: 'desk-s1' }, enabled: true, expired: false },
      { order: 'brief', enabled: true, expired: false },
      { order: 'old-watch', enabled: false, expired: false, last: { outcome: 'failed', t: iso(NOW - 2 * 24 * 60 * MIN) } },
      { order: 'report-q3', strategy: 'cn-market', enabled: true, expired: true },
    ],
    lines: [
      { id: 'pre-close:2026-10-19', kind: 'firing', title: 'pre-close', state: 'running', startedAt: iso(NOW - 4 * MIN), sessionId: 'desk-s2' },
      { id: 'brief:2026-10-19', kind: 'firing', title: 'brief', state: 'done', startedAt: iso(NOW - 90 * MIN), endedAt: iso(NOW - 80 * MIN), sessionId: 'desk-s3' },
      { id: 'report:2026-10-19', kind: 'firing', title: 'report', state: 'failed', startedAt: iso(NOW - 70 * MIN), endedAt: iso(NOW - 69 * MIN) },
      { id: 'annotation:p7', kind: 'annotation', title: 'NVDA AMD', state: 'done', startedAt: iso(NOW - 30 * MIN), endedAt: iso(NOW - 30 * MIN), sessionId: 'desk-s4', text: 'NVDA fell 6% on export news; AMD followed.' },
    ],
  };
  const on = R.nav(R.tasksLoaded(base, { conversation: 's1', tasks, desk, at: NOW }), { screen: 'messages', id: null });
  const alone = R.nav(R.tasksLoaded(base, { conversation: 's1', tasks: [], desk: { scheduled: desk.scheduled.slice(1, 2), lines: [] }, at: NOW }), { screen: 'messages', id: null });
  const page = R.nav(R.tasksLoaded(base, { conversation: 's1', tasks: [], desk, at: NOW }), { screen: 'strategy', id: 'cn-market' });
  const channel = base.channels.find(c => c.name === 'cn-market');
  const strategy = R.channelLoaded(page, { workspaceId: channel.workspaceId, data: { ok: true, channel, status: { status: 'researching' }, body: {} }, at: NOW });
  return [on, alone, strategy];
}

// the read-only pages Tasks 7 and 8 of plan 2 replace: a task's page, a history session, one gone, one before the list, the
// history list full and empty; and Messages while an old #/messages/<id> link waits for the tasks (no composer bound to it)
function sessionPageStates(base) {
  const task = { id: 'g', title: 'Debate', origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW, lastEventAt: NOW, lastSeq: 1 };
  const ready = R.tasksLoaded(base, { conversation: 's1', tasks: [task], at: NOW });
  const plain = R.tasksLoaded(base, { conversation: 's1', tasks: [], at: NOW });
  return [
    R.nav(ready, { screen: 'task', id: 'g' }), R.nav(plain, { screen: 'history', id: 'g' }), R.nav(plain, { screen: 'history', id: 'gone' }),
    R.nav(emptyState(), { screen: 'history', id: 'x' }), R.nav(plain, { screen: 'history', id: null }), R.nav(ready, { screen: 'history', id: null }),
    R.nav(base, { screen: 'messages', id: 's1' }),
  ];
}

// The two default source entries, with a local source badge on each contract. Appended so existing golden state names stay put.
function focusedMarketStates() {
  return [
    ['hyperliquid', 'hyperliquid', 'BTC', 'BTC-PERP', 'Bitcoin perpetual'],
    ['xyz', 'trade-xyz', 'xyz:NVDA', 'xyz:NVDA-PERP', 'NVIDIA perpetual'],
  ].map(([scope, venue, base, symbol, name]) => {
    const s = R.nav(emptyState(), { screen: 'markets', id: null });
    const category = scope === 'xyz' ? 'stocks' : 'crypto';
    const row = { key: `perp:${base}`, kind: 'perp', name, base, price: 100, changePct24h: 1, volumeUsd24h: 1e6, tabs: ['all', 'perps', category],
      at: [{ venue, symbol, venueName: scope === 'xyz' ? 'trade.xyz' : 'Hyperliquid', public: true, connected: false,
        connector: 'live:hyperliquid-trade', connectTo: 'hyperliquid-trade', price: 100 }] };
    return R.exploreLoaded({ ...s, markets: { ...s.markets, scope } }, { tab: 'all', at: NOW,
      data: { ok: true, items: [row], movers: [], closing: [], mostTraded: [], tabs: [{ id: 'all', count: 1 }, { id: category, count: 1 }], missing: [], notes: [] } });
  });
}

// The provider catalog is independent of the selected market, and More opens an exact source, not a connector group.
function providerMarketStates() {
  const s = focusedMarketStates()[0];
  const data = { ok: true, value: [{ id: 'okx', name: 'OKX' }, { id: 'robinhood-stock-tokens', name: 'Robinhood Stock Tokens', kind: 'tokens' },
    { id: 'okx-preipo', name: 'OKX' }, { id: 'hyperliquid-preipo', name: 'Hyperliquid' }] };
  const ready = R.marketSourcesLoaded(s, { data, at: NOW });
  const picked = R.setMarketsLocation(ready, { scope: 'more', source: 'robinhood-stock-tokens' });
  const item = { key: 'rwa:NVDA', kind: 'rwa', base: 'NVDA', name: 'NVIDIA', price: 100, tabs: ['all', 'rwas'],
    at: [{ venue: 'robinhood-stock-tokens', venueName: 'Robinhood Stock Tokens', symbol: 'NVDA', public: true, connected: false, price: 100 }] };
  return [ready, R.exploreLoaded(picked, { tab: 'all', at: NOW, data: { ok: true, items: [item], tabs: [{ id: 'all', count: 1 }, { id: 'rwas', count: 1 }] } }),
    R.marketSourcesLoading(s), R.marketSourcesFailed(s, { at: NOW })];
}

// the Account's page as accountStates reads it, before the seat
function accountRead() {
  const fx = name => JSON.parse(readFileSync(new URL(`../../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
  let read = R.accountLoaded(R.nav(emptyState(), { screen: 'account', tab: 'portfolio' }), { data: fx('account'), at: NOW });
  for (const [loaded, name] of [['holdingsLoaded', 'holdings'], ['paperLoaded', 'holdings-paper'], ['historyLoaded', 'history'], ['statementLoaded', 'statement'], ['agentsLoaded', 'agents']]) {
    read = R[loaded](read, { data: fx(name), at: NOW });
  }
  return read;
}

// Slack (plan B2 Task 7): connected with its Details open, and Install app…'s sheets 1 to 4 (1 with the manifest, 2 in conflict, 4 with
// its note)
function slackStates(signing) {
  const read = { ...signing.identity.data, networks: [...signing.identity.data.networks, { network: 'slack', speaksAs: '@gravit', talksOnlyWith: '@pan', since: '2026-11-04T14:00:00.000Z', fingerprint: 'cd56ef78', state: 'connected', polling: true }], slackManifest: '{\n  "a": 1\n}' };
  const both = R.identityDetails(R.identityLoaded(signing, read), 'slack');
  const pending = { id: 'fedcba9876543210fedcba9876543210', network: 'slack', bot: { id: 'T0FAKE001:U0BOT0001', username: 'gravit', name: 'Gravit' }, workspace: 'Fake Co', link: 'https://slack.com/app_redirect?app=A0FAKE0001&team=T0FAKE001', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'conflict' };
  const heard = { ...pending, state: 'heard', sender: { id: 'T0FAKE001:U0OPER7QK', name: 'Pan', handle: '@pan', userId: 'U0OPER7QK', masked: '…7QK', text: 'hi' } };
  const open = R.identityConnectOpen(both, 'slack');
  return [
    both,
    R.identityConnectSet(open, { copied: true }),
    R.identityConnectSet(open, { step: 2, pending }),
    R.identityConnectSet(open, { step: 3, pending: heard }),
    // (where sheet 4 stood until sign-only-money) the Identity tab after This is me connected Slack
    R.identityConnectClose(R.identityConnectSet(open, { step: 3, pending: heard })),
  ];
}

// iMessage (the iMessage plan): connected with its Details open and a fresh gap; refused; and Connect iMessage's sheets 1 to 4 (1 with
// its three fields, 2 with a stranger heard, 3 the number heard, 4 the owner sheet) and Disconnect iMessage with its note
function imessageStates(signing) {
  const net = { network: 'imessage', speaksAs: '+14155550123', talksOnlyWith: '+14155550100', since: '2026-11-04T14:00:00.000Z', fingerprint: 'ef90ab12', state: 'connected', polling: true };
  const read = { ...signing.identity.data, networks: [...signing.identity.data.networks, { ...net, gapAt: new Date(NOW - 3_600_000).toISOString() }], routing: { ...signing.identity.data.routing, chat: ['imessage', 'telegram'] } };
  const both = R.identityDetails(R.identityLoaded(signing, read), 'imessage');
  const refused = R.identityLoaded(signing, { ...read, networks: [signing.identity.data.networks[0], { ...net, refusedAt: '2026-11-04T14:40:00.000Z' }] });
  const pending = { id: 'aaaabbbbccccddddaaaabbbbccccdddd', network: 'imessage', bot: { id: 'prj_1:+14155550123', username: '+14155550123', name: 'iMessage' }, link: 'sms:+14155550123', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'waiting', strangerHeard: { masked: '…com', at: '2026-11-04T15:01:00.000Z' } };
  const heard = { ...pending, state: 'heard', sender: { id: '+14155550100', name: '+14155550100', handle: '+14155550100', masked: '…100', text: 'hi' } };
  const open = R.identityConnectOpen(signing, 'imessage');
  return [
    both,
    refused,
    R.identityConnectSet(open, { error: t('identity.connect.imessageShape') }),
    R.identityConnectSet(open, { step: 2, pending }),
    R.identityConnectSet(open, { step: 3, pending: heard }),
    // (where sheet 4 and the Disconnect iMessage sheet stood until sign-only-money) the Identity tab after This is me connected
    // iMessage, and Disconnect… asking in its place
    both,
    R.askConfirm(both, { action: 'identityDisconnect', network: 'imessage' }),
  ];
}

// the shortcut sheet (plan 6 Task 15): open over a conversation (its -pc twin draws it off a Mac), with a query, with none
// left, and over Settings, as Show all opens it
function shortcutStates(open) {
  const sheet = q => R.setShortcutsQuery(R.openShortcuts(open), q);
  return [sheet(''), sheet('conv'), sheet('zzz'), R.openShortcuts(R.openSettings(open))];
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
  };
  const kinds = [...SHEET_KINDS.filter(k => Object.hasOwn(seeds, k)), ...Object.keys(seeds).filter(k => !SHEET_KINDS.includes(k))];
  // Identity's three kinds stood last until sign-only-money, which made them no sheet: their places draw what replaced each —
  // Disconnect… asking in place, the grid after its Save, Block asking in place
  const id = identitySigning(R.nav(signs, { screen: 'account', tab: 'identity' }));
  const saved = R.identityLoaded(id, { ...id.identity.data, routing: { ...id.identity.data.routing, brief: ['telegram'] } });
  const sheets = [
    ...kinds.map(kind => R.sheetOpen(signs, { kind, seed: seeds[kind], fields: fieldsOf(kind, seeds[kind]) })),
    R.askConfirm(id, { action: 'identityDisconnect', network: 'telegram' }), saved,
    R.askConfirm(id, { action: 'identityBlock', network: 'telegram', sender: '0123456789ab', masked: '…789' }),
  ];
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
  // Settings' sizes and fonts (plan 6 Task 13): both sizes at their tops, both at their bottoms, a family in each box
  const prefs = (s, kv) => Object.entries(kv).reduce((acc, [name, value]) => R.setPref(acc, { name, value }), s);
  const settings = R.openSettings(read);
  const sized = [prefs(settings, { textSize: 20, codeSize: 16 }), prefs(settings, { textSize: 12, codeSize: 10 }), prefs(settings, { textFont: 'Inter', codeFont: 'JetBrains Mono' })];
  return [...money, ...rules, ...sheets, prepared, ...markets, ...watch, ...sized];
}
// the composer's states (plan 3 of the dsh UI port, Task 3): a / menu with headings and with a query, an @ menu with every kind,
// a folder walk with its crumb, in a conversation's composer; a draft with each chip kind in the editor; the operator's words
// with a conversation mention, a chip in the bubble (D17)
// a conversation's composer, each piece its own entry (composerPieces): a / menu with headings and with a query, an @ menu with
// every kind, a folder walk with its crumb; the operator's words with a conversation mention, a chip in the bubble (D17); a draft
// with each chip kind in the editor
function composerBuild() {
  const open = onConv(R.hostList(emptyState(), { conversations: [conv('s1')], channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true, dir: '/r' }] }), 's1');
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
  const inputs = [open, menus, mention, files, { note: 'Up to 20 images a message' }, DEFAULT_LIMITS, history, masked, railed, outline, jobsOn, jobRows, runs];
  return { pieces, inputs };
}
export const composerPieces = () => composerBuild().pieces;
export const screenOf = (st, now) => (st.route.screen === 'markets' ? renderMarketsScreen(st, now) : st.route.screen === 'account' ? renderAccountScreen(st, now)
  : st.route.screen === 'trade' ? renderTradeScreen(st, now)
  : st.route.screen === 'strategy' ? renderStrategyScreen(st, now) : st.route.screen === 'discover' ? renderDiscover(st, now)
  : st.route.screen === 'history' ? renderHistoryScreen(st, now)
  : st.route.screen === 'task' ? renderTaskScreen(st, now)
  : st.route.screen === 'plugin' ? renderPlugin(st, now) : st.route.screen === 'module' ? renderModule(st, now) : renderMessagesScreen(st, now));

// a state's page as css.test.js draws it: the rail, the screen, then every drawer and sheet that may stand over it
export function pageHtml(st, { mac = true } = {}) {
  return renderRail(st, NOW, { mac }) + screenOf(st, NOW) + (st.settingsOpen ? renderSettings(st, { mac }) : '') + stockDrawerHtml(st) + renderSellMany(st) +
    renderSheet(st, NOW) + renderConnectDrawer(st) + renderRunSheet(st, NOW) + renderShortcuts(st, { mac });
}

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

// lines a host writes into the store from its own source, drawn as the page would: a module card's Run that could not send,
// or found Gravit's conversation not known (host/run-sheet.js); an Answer pressed with a question unanswered (app.js). The states come from running the host, so a
// word moved there shows here
export async function hostCorpus() {
  const entries = [];
  {
    const known = R.tasksLoaded(R.nav(emptyState(), { screen: 'discover', id: null }), { conversation: 'c-gravit', tasks: [], at: NOW });
    const store = createStore({ initial: known, reducers: R });
    const sheet = startRunSheet({ store, actions: { send: async () => null }, readListing: async () => modulesListing(), go: () => {}, now: () => NOW });
    await sheet.open('theme');
    await sheet.run();
    entries.push(['host-run-sheet-failed', renderRunSheet(store.get(), NOW)]);
  }
  {
    const store = createStore({ initial: R.nav(emptyState(), { screen: 'discover', id: null }), reducers: R });
    const sheet = startRunSheet({ store, actions: { send: async () => null }, readListing: async () => modulesListing(), go: () => {}, now: () => NOW });
    await sheet.open('theme');
    await sheet.run();
    entries.push(['host-run-sheet-no-conversation', renderRunSheet(store.get(), NOW)]);
  }
  {
    const f = fakeWindow({ hash: '' });
    let opts = null;
    const mux = { stream: () => ({ cancel() {} }), answer: async () => {}, close() {} };
    const rows = [{ sessionId: 's1', updatedAt: 5, agentAvailable: false, running: false, blank: false }];
    const call = async endpoint => (endpoint === 'session/list' ? { items: rows } : endpoint === 'session/projections' ? { asOfSeq: 20, values: {} } : endpoint === 'session/page' ? { records: [] } : undefined);
    const getJson = async path => (path === '/data/channels.json' ? { ok: true, root: '/r', channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true, sessionIds: [] }], ungrouped: [], archived: [], presets: {} }
      : path === '/data/sessions-meta.json' ? { ok: true, archived: [], deleted: [] } : path === '/data/tasks' ? { ok: true, conversation: 's1', tasks: [] } : { ok: true, bots: [] });
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

// the corpus, named and in order: every state, again off a Mac when it draws the side panel (whose search key names the chord), then
// the composer's pieces; the markdown renderer unset, as the screens draw with it
export function corpus() {
  setMarkdown(null);
  const states = everyState().flatMap((st, i) => [[`state-${i}`, pageHtml(st)], ...(renderSide(st, NOW) ? [[`state-${i}-pc`, pageHtml(st, { mac: false })]] : [])]);
  return [...states, ...composerPieces().map(([name, html]) => [`composer-${name}`, html])];
}

// the fields whose strings are words a screen draws as they come — the operator's, Gravit's, a bot's, a venue's or the
// Account's prose, a name, a ticker, a path — and the only ones corpusStrings counts outside an upstream's content: a code
// (a status, a screen, a phase, a run's state, an id) is never one, so a code word drawn as a word (failed, running,
// messages) is the probe's to find
const CONTENT_FIELDS = new Set([
  // prose
  'text', 'title', 'name', 'label', 'note', 'notes', 'message', 'description', 'question', 'header', 'prompt', 'response', 'detail',
  'displayReason', 'reason', 'why', 'whyNot', 'said', 'error', 'words', 'what', 'example', 'via', 'readOnlyBecause', 'noTradeBecause',
  'proven', 'lands', 'guard', 'beast', 'door', 'request', 'plan', 'soul', 'legs', 'line', 'broken', 'setupIssues', 'freezes',
  'placeholder', 'rate', 'whose', 'by', 'sub', 'subtitle', 'frontLine', 'category', 'age', 'steps', 'body',
  // names: a venue's, a product's, an agent's, an account's, a market's, a network's
  'productName', 'protocol', 'quoteFrom', 'sourceWord', 'venueName', 'accountName', 'agentName', 'byName', 'toName', 'unitWord',
  'network', 'networks', 'chain', 'chains', 'bridgeChains', 'funded', 'exchange', 'feed', 'source', 'model', 'route', 'runtime',
  'server', 'bin', 'bot', 'handle', 'speaksAs', 'talksOnlyWith', 'username', 'tile', 'tools', 'toolName', 'headline', 'channelWords',
  'strategy', 'where', 'roleId', 'zone', 'clock', 'code', 'workspace',
  // tickers, assets and currencies
  'symbol', 'asset', 'assets', 'base', 'quote', 'token', 'sourceToken', 'toAssets', 'dollars', 'currency',
  // paths, commands and links
  'file', 'path', 'dir', 'crumb', 'folder', 'command', 'turnOn', 'link', 'url', 'home', 'homeCwd', 'defaultRef',
  // what the operator typed: a search, a font family
  'q', 'query', 'textFont', 'codeFont',
  // an address, a key's id, a signer, a hash: drawn as they come
  'address', 'toAddress', 'agent', 'signer', 'kid', 'hash', 'fingerprint', 'userId',
  // the Account's sentences and lists: a market with no trades, a limit's hosts and venues, a venue that only watches
  'none', 'allow', 'watchOnly',
  // a starred market's key: the probe reads its symbol
  'watch',
]);
// the parts of a state that are an upstream's content as a whole, drawn as they come, every string in them and its keys too
// (a metric's name): a run's view and its artifacts (Lunhui's output), a strategy's files (Gravit's) and its paper positions
// (the venue its status.yaml names and the Account's rows or refusal), What you sign's lines
// (the Account's: every `shown`), and the two rows the face draws in the Account's own grammar, codes and all — an open
// order (venue · side size · type · status · who) and an agent's limit (scope · status · allow); `*` is any one key
const CONTENT = [['lunhui', 'views', '*', 'view'], ['discover', 'shelves', 'modules', 'data'], ['channel', 'data'], ['channel', 'positions', 'venue'], ['channel', 'positions', 'rows'], ['**', 'shown'],
  ['account', 'data', 'orders'], ['account', 'agents', 'data', 'agents', 'limits']];
const isContent = at => CONTENT.some(c => (c[0] === '**' ? at.at(-1) === c[1] : c.length === at.length && c.every((p, i) => p === '*' || p === at[i])));

// every string, as { text, key }, the corpus' own states, the composer pieces' inputs and the module catalog (its sub-titles,
// roles, codes and rulings' citations: content, spec §5.10) hold in a content field, or anywhere inside an upstream's content:
// the words a screen may draw that are not the face's (words-probe.test.js). An object met again is walked again when it is
// met in another mode (inside content or not), never twice in the same one
export function corpusStrings() {
  const out = [];
  const seen = new Map();
  const walk = (v, key, path, content) => {
    if (typeof v === 'string') { if (content || CONTENT_FIELDS.has(key)) out.push({ text: v, key }); return; }
    if (v === null || typeof v !== 'object') return;
    const modes = seen.get(v) ?? new Set();
    if (modes.has(content)) return;
    seen.set(v, modes.add(content));
    if (v instanceof Map) { for (const [k, x] of v) { walk(k, null, path, content); walk(x, typeof k === 'string' ? k : null, path, content); } return; }
    if (v instanceof Set || Array.isArray(v)) { for (const x of v) walk(x, key, path, content); return; }
    for (const [k, x] of Object.entries(v)) {
      const at = [...path, k];
      const inside = content || isContent(at);
      if (inside === true) out.push({ text: k, key: null });
      walk(x, k, at, inside);
    }
  };
  for (const st of everyState()) walk(st, null, [], false);
  walk(composerBuild().inputs, null, [], false);
  walk(MODULES, null, [], 'values'); // every value, its keys not
  return out;
}
