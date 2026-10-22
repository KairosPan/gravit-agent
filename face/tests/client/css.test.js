// The stylesheet against the screens stage 1 draws: every class has a rule, no colour by hex, the layout rules the design fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { renderRail } from '../../client/js/render/rail.js';
import { renderMessagesScreen } from '../../client/js/render/messages.js';
import { renderMarketsScreen } from '../../client/js/render/markets.js';
import { renderSettings, renderAccountScreen } from '../../client/js/render/account.js';
import { renderChannelScreen } from '../../client/js/render/channel.js';
import { renderDiscover, renderPlugin } from '../../client/js/render/discover.js';
import { listings } from './helpers/inventory.js';
import { setMarkdown } from '../../client/js/render/thread.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';
import { renderMarkdown } from '../../client/js/wire/markdown.js';
import { withMiniDocument } from './helpers/mini-dom.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const css = await readFile(new URL('../../client/css/app.css', import.meta.url), 'utf8');
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const m = (id, over = {}) => ({ id, seq: 1, at: NOW, from: 'gravit', kind: 'text', text: 'hello', data: {}, ...over });
const KINDS = [
  m('e1', { from: 'you', text: 'hi' }), m('e2', { data: { markdown: true, interrupted: true } }), m('e3', { from: 'system', text: 'round 1' }),
  m('tc1', { kind: 'tool', text: 'bash', data: { callId: 'c1', title: 'ls', result: 'ok', isError: true } }),
  m('ev-1', { kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 's1', venue: 'Alpaca paper', line: 'PAPER order' } }),
  m('ev-2', { kind: 'approval', text: 'Run?', data: { eventId: 'ev-2', sessionId: 's1', toolName: 'bash', reason: 'audit', displayReason: 'Run?' } }),
  m('ev-3', { kind: 'question', text: '', data: { eventId: 'ev-3', sessionId: 's1', questions: [{ id: 'q1', question: 'Pin?', header: 'Gate', options: [{ label: 'Yes', description: 'd' }] }, { id: 'q2', question: 'More?' }] } }),
  m('ev-4', { kind: 'card', text: 'Done', answer: 'elsewhere', data: { eventId: 'ev-4', sessionId: 's1' } }),
  m('rc1', { kind: 'receipt', text: 'Order accepted', data: {} }), m('rc2', { kind: 'refusal', text: 'no', data: { code: 'E1' } }),
  m('e9', { from: 'buffett', text: '买', data: { name: '巴菲特型' } }),
  m('e10', { from: 'system', text: 'runtime snapshot', data: { source: 'runtime' } }),
  m('tc2', { kind: 'tool', text: 'market_snapshot', data: { callId: 'c2', name: 'mcp__alpaca-kit__market_snapshot', result: JSON.stringify({ ok: true, rows: [{ symbol: 'A', close: 2, prev_close: 1, volume: 1 }, { symbol: 'B', close: 1, prev_close: 2, volume: 1 }] }) + '\n(Omitted 9 bytes. Full formatted result stored at: /tmp/x)' } }),
  m('tc3', { kind: 'tool', text: 'account', data: { callId: 'c3', name: 'mcp__alpaca-kit__account', result: JSON.stringify({ ok: true, equity: '1', cash: '2' }) } }),
  m('tc4', { kind: 'tool', text: 'breadth', data: { callId: 'c4', name: 'mcp__alpaca-kit__breadth', result: JSON.stringify({ ok: true, ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])) }) } }),
  m('tc5', { kind: 'tool', text: 'daily_bars', data: { callId: 'c5', name: 'mcp__alpaca-kit__daily_bars', result: JSON.stringify({ ok: true, rows: [{ date: '2026-10-16', close: 1 }, { date: '2026-10-17', close: 2 }] }) } }),
  m('tc6', { kind: 'tool', text: 'calendar', data: { callId: 'c6', name: 'mcp__alpaca-kit__calendar', result: JSON.stringify({ ok: true, days: ['2026-10-19'] }) } }),
  m('tc7', { kind: 'tool', text: 'positions', data: { callId: 'c7', name: 'mcp__alpaca-kit__positions', result: JSON.stringify({ ok: true, rows: [] }) } }),
];

const asset = (id, over = {}) => ({ id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), name: id.slice(id.indexOf(':') + 1), exchange: 'NASDAQ', currency: id.startsWith('cn:') ? 'CNY' : 'USD', ...over });
const quote = (id, over = {}) => ({ id, market: id.slice(0, id.indexOf(':')), symbol: id.slice(id.indexOf(':') + 1), price: 10, prev_close: 9, change: 1, change_pct: 1.5, volume: 1000, as_of: '2026-10-19T14:30:00Z', received_at: null, volume_as_of: null, source: 'Alpaca', feed: 'iex', basis: 'previous_close', quote_status: 'live', market_status: 'closed', message: '', ...over });
// Markets: the list empty, with rows (one held, one with no quote), searching, a failed search, polling, a full watchlist
function marketStates() {
  const on = R.nav(emptyState(), { screen: 'markets', id: null });
  const rows = R.quotesUpdated(R.accountLoaded(R.watchlistLoaded(on, { items: [asset('us:AAPL'), asset('cn:600519'), asset('crypto:BTC/USD')], error: null }), { data: { ok: true, available: true, host: 'paper-api.alpaca.markets', account: {}, positions: [{ symbol: 'AAPL', asset_class: 'us_equity' }], orders: [] }, at: NOW }),
    { quotes: { 'us:AAPL': quote('us:AAPL', { change_pct: -1 }), 'cn:600519': quote('cn:600519', { volume: null, change_pct: 0 }) }, providers: [], status: 'streaming' });
  const searching = q => R.setMarketsQuery(rows, q);
  return [
    on, rows, R.setMarketsTab(rows, 'stocks'),
    R.searchUpdated(searching('nv'), { query: 'nv', status: 'loading', assets: [], partial: false }),
    R.searchUpdated(searching('nv'), { query: 'nv', status: 'success', assets: [asset('us:NVDA'), asset('us:NVDL')], partial: true }),
    R.searchUpdated(searching('zz'), { query: 'zz', status: 'error', assets: [], partial: false }),
    R.quotesUpdated(rows, { quotes: {}, providers: [], status: 'polling' }),
    R.watchlistLoaded(rows, { items: rows.markets.watchlist, error: 'full' }),
    // a us page with its chart, a holding, a statement row and a conversation naming it; a crypto page; a page with no quote
    R.barsLoaded({ ...R.accountLoaded(R.nav(rows, { screen: 'markets', id: 'us:AAPL' }), { data: { ok: true, available: true, host: 'paper-api.alpaca.markets', account: { equity: '1' }, positions: [{ symbol: 'AAPL', asset_class: 'us_equity', qty: '5', market_value: '600', change_today: '0.01' }], orders: [{ id: 'o1', symbol: 'AAPL', side: 'buy', qty: '1', filled_qty: '1', filled_avg_price: '10', type: 'market', status: 'filled', submitted_at: '2026-10-18T14:00:00Z', filled_at: '2026-10-18T14:00:00Z' }] }, at: NOW }), conversations: [conv('s7', { title: 'Is AAPL cheap?' })] },
      { id: 'us:AAPL', payload: { ok: true, source: 'bed', feed: null, as_of: '2026-07-09', rows: [{ date: '2026-07-08', close: 10 }, { date: '2026-07-09', close: 11 }] } }),
    R.nav(rows, { screen: 'markets', id: 'crypto:BTC/USD' }),
    R.nav(on, { screen: 'markets', id: 'us:MSFT' }),
  ];
}

// Account over the stand-in's answers (tests/fixtures/account/): Portfolio read (stale, after a refusal), a page the face does
// not recognise, failed with nothing loaded, loading, the Statement open, Settings, Venues with a venue's Details, Agents, Cards
function accountStates() {
  const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
  const on = R.nav(emptyState(), { screen: 'account', tab: 'portfolio' });
  let read = R.accountLoaded(on, { data: fx('account'), at: NOW });
  for (const [loaded, name] of [['holdingsLoaded', 'holdings'], ['paperLoaded', 'holdings-paper'], ['historyLoaded', 'history'], ['statementLoaded', 'statement'], ['agentsLoaded', 'agents']]) {
    read = R[loaded](read, { data: fx(name), at: NOW });
  }
  const seated = R.seatLoaded(read, { data: { ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-19T14:00:00Z', mode: 'guard', writes: { on: true, capUsd: 100 }, seat: { name: 'Gravit', status: 'admitted', address: '0xab12', limits: [] }, venues: [], cards: [] }, at: NOW });
  const at = tab => R.nav(seated, { screen: 'account', tab });
  return [
    R.accountFailed(read, { at: NOW, message: 'The Account is locked until its owner signs in.' }), R.accountLoaded(on, { data: { ok: true, available: false }, at: NOW }), R.accountFailed(on, { at: NOW }), R.accountLoading(on),
    R.openStatement(read), R.openSettings(read), R.openVenueDetails(at('venues'), 'ex'), at('agents'), at('cards'),
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
function discoverStates() {
  let all = emptyState();
  for (const [shelf, v] of Object.entries(listings())) all = R.shelfLoaded(all, { shelf, data: v.data, at: 1 });
  const at = route => R.nav(all, route);
  const page = id => at({ screen: 'plugin', id });
  return [
    at({ screen: 'discover', id: null }), R.shelfFailed(at({ screen: 'discover', id: null }), { shelf: 'bots', at: 1 }), R.nav(emptyState(), { screen: 'discover', id: null }),
    R.setDiscoverQuery(at({ screen: 'discover', id: null }), 'rules'), at({ screen: 'discover', id: 'agents' }),
    page('mcp:alpaca-kit'), page('bot:buffett'), page('agent:codex'), page('agent:claude'), page('agent:gravit'), page('bot:nobody'),
    R.gravitLoaded(page('agent:gravit'), { host: { cwd: '/r', home: '/h', attachedSessions: 1, version: 'v' }, model: false, keys: { DEEPSEEK_API_KEY: { configured: true } } }),
    R.skillLoaded(page('skill:rules'), { name: 'rules', detail: { content: '# R', group: 'mechanics' } }),
    R.discoverStatus(at({ screen: 'discover', id: null }), { line: 'connect: binary did not answer on this machine', bad: true }),
    R.modelsLoaded(R.startEdit(page('bot:buffett'), { kind: 'bot', id: 'buffett' }), { choices: [{ value: 'deepseek/deepseek-chat', label: 'DeepSeek · Chat' }] }),
    R.modelsLoaded(at({ screen: 'discover', id: 'create' }), { choices: [] }),
    R.shelfLoaded(page('bot:buffett'), { shelf: 'bots', data: { ok: true, bots: [{ ...listings().bots.data.bots[1], broken: 'cannot mount' }] }, at: 2 }),
  ];
}

// the states stage 1 can show: empty, a conversation with every kind, a group thinking, Details, Settings, a draft, a bad status, the rail folded
function everyState() {
  const base = R.hostList(emptyState(), { conversations: [conv('s1', { messages: KINDS, running: true, usage: { tokenUsage: { outputTokens: 1 }, contextPressure: 0.5 }, created: NOW }), conv('g', { kind: 'group', members: ['gravit', 'buffett'], thinking: 'text', messages: [m('g1', { from: 'buffett', text: 'hold', data: { name: 'Buffett Type', markdown: true, memberSessionId: 'm1', memberTurn: 2 } })] })], channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true }], bots: [{ id: 'buffett', name: 'Buffett Type' }] });
  const open = R.nav(base, { screen: 'messages', id: 's1' });
  return [
    emptyState(), open, R.nav(base, { screen: 'messages', id: 'g' }), R.toggleDetails(open), R.askConfirm(R.toggleDetails(open), { action: 'stopGravit', id: 's1' }),
    R.startEdit(R.toggleDetails(open), { kind: 'rename', convId: 's1', error: 'Cannot be empty' }), R.openSettings(open), R.startDraft(open, { now: NOW }),
    R.startEdit(R.startDraft(open, { now: NOW }), { kind: 'newChannel', error: 'Letters, digits, - or _' }),
    R.hostStatus(open, { line: 'Reconnecting…', bad: true }), R.toggleRail(open),
    R.traceLoaded(R.nav(base, { screen: 'messages', id: 'g' }), { convId: 'g', msgId: 'g1', messages: [m('tg1', { kind: 'tool', text: 'account', data: { callId: 'g1c', name: 'mcp__alpaca-kit__account', result: JSON.stringify({ ok: true, equity: '1' }) } }), m('tg2', { from: 'system', text: 'context' })] }),
    R.toggleDetails(R.hostList(R.hostProjection(open, { convId: 's1', key: 'subagentCatalog', value: [{ id: 'k1', createdAt: 1, mode: 'continuable', label: 'Check' }, { id: 'k2', createdAt: 2, mode: 'unknown' }] }), { conversations: open.conversations, childRows: [{ sessionId: 'k1', parentSessionId: 's1', running: true, origin: 'subagent' }] })), ...marketStates(), ...accountStates(), ...channelStates(), ...discoverStates(),
  ];
}
const screenOf = (st, now) => (st.route.screen === 'markets' ? renderMarketsScreen(st, now) : st.route.screen === 'account' ? renderAccountScreen(st, now)
  : st.route.screen === 'channel' ? renderChannelScreen(st, now) : st.route.screen === 'discover' ? renderDiscover(st, now)
  : st.route.screen === 'plugin' ? renderPlugin(st, now) : renderMessagesScreen(st, now));

test('every class the screens emit has a rule in app.css, and app.css names no colour by hex', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, 'colours come from tokens.css');
  setMarkdown(null);
  const html = everyState().map(st => renderRail(st, NOW) + screenOf(st, NOW) + (st.settingsOpen ? renderSettings(st) : '')).join('');
  for (const c of ['mkts', 'mk-tab', 'mk-star', 'mk-name', 'mk-tag', 'mk-q', 'mk-clear', 'mk-note', 'mk-empty', 'mk-st', 'page-back', 'mk-chart', 'mk-axis', 'mk-facts', 'mk-big', 'mk-basis', 'mk-asof', 'mk-d-acts', 'mk-line', 'mk-on', 'acct', 'networth', 'acct-figures', 'acct-second', 'acct-t', 'acct-shown', 'order-row', 'acct-note', 'activity-row', 'venue', 'account-line']) assert.match(html, new RegExp(`class="[^"]*\\b${c}\\b`), `Markets emits ${c}`);
  const classes = new Set(html.match(/class="([^"]+)"/g).flatMap(x => x.slice(7, -1).split(/\s+/)));
  const missing = [...classes].filter(c => c && !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], 'classes without a rule');
  assert.match(css, /--rail/);
  assert.match(css, /\.key\.yes[^{]*\{[^}]*color: var\(--up\)/);
  assert.match(css, /\.key\.no[^{]*\{[^}]*color: var\(--down\)/);
});

test('every class app.css styles is emitted by some screen: no rule outlives the screen it styled', () => {
  setMarkdown(null);
  const sample = '# H1\n\n## H\n\n### H3\n\n#### H4\n\n**b** `c` [l](https://x.test)\n\n- a\n\n> q\n\n---\n\n```\nx\n```\n\n| s | c |\n|---|---|\n| A | +1% |\n| B | -1% |';
  const page = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
  const html = page + everyState().map(st => renderRail(st, NOW) + screenOf(st, NOW) + (st.settingsOpen ? renderSettings(st) : '')).join('') +
    withMiniDocument(() => renderMarkdown(sample).node.outerHTML);
  const emitted = new Set(html.match(/class="([^"]+)"/g).flatMap(x => x.slice(7, -1).split(/\s+/)));
  const styled = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
  assert.deepEqual([...styled].filter(c => !emitted.has(c)).sort(), [], 'rules for classes no screen emits');
});

test('the layout: one screen tall, the thread scrolls under a pinned composer, the drawer is fixed', () => {
  const rule = sel => css.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.main'), /(?:^|;)\s*height: 100vh/, 'a real height, not a minimum');
  assert.match(rule('.thread'), /overflow-y: auto/);
  assert.match(rule('.thread'), /flex: 1/);
  assert.match(rule('.drawer'), /position: fixed/);
  assert.match(rule('.status-line'), /text-align: center/);
});

test('Details never covers the conversation: it makes room, folding the list away on a medium window', () => {
  assert.match(css, /\.main\.with-drawer > \.head, \.main\.with-drawer > \.thread, \.main\.with-drawer > \.composer \{ margin-right: 400px; \}/);
  assert.match(css, /@media \(min-width: 861px\) and \(max-width: 1399px\) \{\s*\.list:has\(~ \.main\.with-drawer\) \{ display: none; \}/);
});

test('a long tool description is clamped to two lines, and the page keys keep a gap', () => {
  const rule = sel => css.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.tool-desc'), /-webkit-line-clamp: 2/);
  assert.match(rule('.plug-key'), /gap: 8px/);
});

test('the tool row, the question card and the thinking row have their rules', () => {
  for (const sel of ['.tool summary', '.tool pre', '.tool.danger', '.question .q', '.opt', '.thinking span', '.cut', '.status-line.bad']) {
    assert.ok(new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{').test(css), sel);
  }
});

test('every token app.css reads is declared: a var(--x) nobody defines falls back to inherit and the rule silently does nothing', async () => {
  const tokens = await readFile(new URL('../../client/css/tokens.css', import.meta.url), 'utf8');
  const declared = new Set((tokens + css).match(/--[\w-]+(?=\s*:)/g));
  const read = new Set(css.match(/var\(\s*(--[\w-]+)/g).map(x => x.replace(/var\(\s*/, '')));
  assert.deepEqual([...read].filter(t => !declared.has(t)), [], 'tokens read but never declared');
});

test("Gravit's markdown has its rules: every class markdown.js emits, and links in an answer that look like links", () => {
  const sample = '## Breadth\n\n**NVDA** leads; see [the filing](https://www.sec.gov/x) and `ADV`.\n\n- one\n  - two\n\n1. first\n\n> a quote\n\n---\n\n```\nzstd -dc log\n```\n\n| sym | chg |\n|---|---|\n| NVDA | +3.1% |\n| AMD | -1.2% |';
  const html = withMiniDocument(() => renderMarkdown(sample).node.outerHTML);
  const classes = new Set(html.match(/class="([^"]+)"/g).flatMap(x => x.slice(7, -1).split(/\s+/)));
  for (const c of ['md', 'md-h', 'md-h2', 'md-code', 'md-list', 'md-quote', 'md-hr', 'md-fence', 'md-tablewrap', 'viz-table', 'num', 'up', 'down']) assert.ok(classes.has(c), `the sample emits ${c}`);
  const missing = [...classes].filter(c => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], 'markdown classes without a rule');
  assert.match(css, /\.md a\s*\{[^}]*color: var\(--[\w-]+\)/, 'a link in an answer carries a colour of its own');
  assert.match(css, /\.md-tablewrap\s*\{[^}]*overflow-x: auto/, 'a wide table scrolls inside the bubble');
});

test('app.css is well formed: braces never close more than they opened, so no rule is swallowed', () => {
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; assert.ok(depth >= 0, 'a } without its {'); }
  }
  assert.equal(depth, 0);
});

test('the equity blue goes by Linqi\'s own name: no --blue, which his tokens use for the orange RWA colour', async () => {
  const tokens = await readFile(new URL('../../client/css/tokens.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /var\(--blue\)/);
  assert.match(tokens, /--alloc-equity/);
  assert.match(tokens, /--on-equity/);
});
