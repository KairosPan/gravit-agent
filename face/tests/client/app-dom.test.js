// boot() against a fake window and a fake host: what the person sees after the list lands, opening, sending, answering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot } from '../../client/js/app.js';
import { fakeWindow } from './helpers/fake-dom.js';

const frames = readFileSync(new URL('../fixtures/events.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const row = (id, over = {}) => ({ sessionId: id, updatedAt: 5, agentAvailable: false, running: false, blank: false, ...over });

// a fake host: the mux records its streams and keeps the options; the calls are canned per endpoint and recorded
function host({ rows = [], pages = {}, meta = { ok: true, archived: [], deleted: [] } } = {}) {
  const channelRows = [{ workspaceId: 'w0', name: 'workbench', isRoot: true, sessionIds: [] }];
  const streams = [];
  let opts = null;
  const mux = { stream(name, args, cbs) { const s = { name, args, cbs, cancelled: false }; streams.push(s); return { cancel() { s.cancelled = true; } }; }, answer: async (id, value) => { answered.push([id, value]); }, close() {} };
  const answered = [];
  const calls = [];
  const call = async (endpoint, args) => {
    calls.push([endpoint, args]);
    if (endpoint === 'session/list') return { items: rows };
    if (endpoint === 'session/projections') return { asOfSeq: 20, values: {} };
    if (endpoint === 'session/page') { const pg = pages[args.request.address.sessionId]; return Array.isArray(pg) || pg === undefined ? { records: pg ?? [] } : pg; }
    if (endpoint === 'session/create' && args.request.agentPreset) { rows.push(row('s-bot', { updatedAt: 120, agentAvailable: true, projections: { values: { agentPreset: args.request.agentPreset } } })); return { sessionId: 's-bot', agentPreset: args.request.agentPreset }; }
    if (endpoint === 'session/create') { rows.push(row('s-new', { agentAvailable: true })); return { sessionId: 's-new', agentPreset: 'gravit' }; }
    if (endpoint === 'session/fork') { rows.push(row('s-fork', { updatedAt: 99, agentAvailable: true })); return { sessionId: 's-fork' }; }
    return undefined;
  };
  const reads = [];
  const inventory = {
    '/data/plugins.json': { ok: true, mcp: [{ server: 'alpaca-kit', phase: 'active', tools: [] }], agentTools: [], rows: [] },
    '/data/agents.json': { ok: true, main: { name: 'Gravit', runtime: 'dsh 0.2.0-rc.2' }, local: [], candidates: [{ bin: 'claude', label: 'Claude Code', version: '2.1' }] },
    '/data/memory.json': { ok: true, groups: [] },
    '/data/bots.json': { ok: true, bots: [{ id: 'buffett', name: 'Buffett Type', description: '', homeCwd: '/r/bots/buffett/home', soul: '# B', revision: 'r1', isDefault: false, listed: true, skills: [], setupIssues: [] }] },
  };
  const getJson = async path => { reads.push(path); return path === '/data/channels.json' ? { ok: true, root: '/r', channels: [...channelRows], ungrouped: [], archived: [], presets: {} } : path === '/data/sessions-meta.json' ? meta : inventory[path] ?? { ok: true, bots: [] }; };
  const posted = [];
  const postJson = async (path, body) => {
    posted.push([path, body]);
    // the face's two session routes, as the host would apply them to the next list
    if (path === '/data/sessions/delete') { const i = rows.findIndex(r => r.sessionId === body.sessionId); if (i >= 0) rows.splice(i, 1); }
    if (path === '/data/sessions/archive') meta.archived = body.archived ? [...meta.archived, body.sessionId] : meta.archived.filter(id => id !== body.sessionId);
    if (path === '/data/channels') { const dir = `/r/strategies/${body.name}`; channelRows.push({ workspaceId: `w-${body.name}`, name: body.name, title: body.name, dir, isRoot: false, sessionIds: [] }); return { ok: true, name: body.name, dir, isRoot: false }; }
    if (path === '/data/channels/overview') return { ok: true, channel: channelRows.find(c => c.workspaceId === body.workspaceId), status: {}, body: {}, agents: [], bots: ['buffett'], allBots: [{ id: 'gravit', name: 'Gravit' }, { id: 'kairos', name: 'Kairos' }, { id: 'buffett', name: 'Buffett' }, { id: 'drill-bear', name: 'Bear' }] };
    if (path === '/data/channels/bots') return { ok: true, bots: body.bots };
    if (path === '/data/bots/settings') { const b = inventory['/data/bots.json'].bots[0]; inventory['/data/bots.json'] = { ok: true, bots: [{ ...b, name: body.name, description: body.description, soul: body.soul, model: body.model ?? undefined, revision: 'r2' }] }; return { ok: true }; }
    if (path === '/data/bots') { inventory['/data/bots.json'] = { ok: true, bots: [...inventory['/data/bots.json'].bots, { id: body.id ?? 'macro', name: body.name, description: '', homeCwd: '/r/bots/macro/home', soul: '', revision: 'm1', isDefault: false, listed: true, skills: [], setupIssues: [] }] }; return { ok: true, bot: { id: body.id ?? 'macro', name: body.name, listed: true } }; }
    if (path === '/data/agents/connect') { const c = inventory['/data/agents.json'].candidates.find(a => a.bin === body.bin); inventory['/data/agents.json'] = { ...inventory['/data/agents.json'], local: [{ ...c, found: true, auth: { state: 'ok' } }], candidates: [] }; return { ok: true, agent: c }; }
    return { ok: true, addressed: [] };
  };
  return { openMux: o => { opts = o; return mux; }, call, getJson, postJson, markdown: null, calls, posted, answered, streams, rows, reads, ready: async () => { opts.onReady({}); await settle(); }, opts: () => opts };
}
const started = (f, h) => boot(f.win, { openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown });
const send = f => f.fire('root', 'submit', { target: { closest: () => ({ dataset: { action: 'send' } }) } });

test('before the host answers, the empty state shows with a connecting status line; the list then draws rows and opens the first', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { projections: { values: { title: 'One' } } }), row('s2', { updatedAt: 9 })] });
  const store = started(f, h);
  assert.match(f.html(), /Nothing handed to Gravit yet/);
  assert.match(f.html(), /status-line" role="status">connecting…</);
  await h.ready();
  assert.match(f.html(), /row-title">One</);
  assert.equal(store.get().route.id, 's2', 'the newest first, as the list orders them');
  assert.equal(h.calls.some(c => c[0] === 'session/page' && c[1].request.address.sessionId === 's2' && c[1].request.maxMessages === undefined), true, 'the open one was paged');
  assert.doesNotMatch(f.html(), /connecting…/);
  store.timers.clear();
});

test('a deep link to a conversation the list has not carried yet opens it once the list lands', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const h = host({ rows: [row('s1'), row('s2', { updatedAt: 9 })] });
  const store = started(f, h);
  await h.ready();
  assert.equal(store.get().route.id, 's1');
  assert.match(f.html(), /row current[^>]*href="#\/messages\/s1"/);
  store.timers.clear();
});

test('clicking a row opens it: the page read happens and its dot clears; the composer sends a prompt and empties', async () => {
  const f = fakeWindow({ hash: '' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { updatedAt: 50, agentAvailable: true }), row('s2', { updatedAt: 9 })] });
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  assert.equal(store.get().route.id, 's2');
  assert.equal(store.get().conversations.find(c => c.id === 's2').lastSeen, 9);
  say.value = 'look at ETH';
  f.fire('root', 'input', { target: say });
  send(f);
  await settle();
  const prompt = h.calls.find(c => c[0] === 'session/prompt');
  assert.equal(prompt[1].request.sessionId, 's2'); assert.equal(prompt[1].request.content[0].text, 'look at ETH');
  assert.equal(say.value, '');
  assert.equal(h.streams.filter(s => s.name === 'session/follow' && s.args.request.address.sessionId === 's2').length, 1, 'the prompt promoted the paged session to a follow');
  store.timers.clear();
});

test('a new message creates the session in the chosen channel, names it, prompts it, and the page moves to it', async () => {
  const f = fakeWindow({ hash: '' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const title = f.withId('nm-title', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  assert.match(f.html(), /<select id="nm-where"/);
  title.value = 'BTC under 70k';
  f.fire('root', 'input', { target: { ...title, dataset: { action: 'draftTitle' } } });
  say.value = 'Buy a little';
  f.fire('root', 'input', { target: say });
  send(f);
  await settle();
  assert.deepEqual(h.calls.filter(c => c[0] !== 'session/list' && c[0] !== 'session/projections' && c[0] !== 'session/page').map(c => c[0]), ['session/create', 'session/rename', 'session/prompt']);
  assert.deepEqual(h.calls.find(c => c[0] === 'session/create')[1], { request: { workspaceId: 'w0' } });
  assert.equal(h.calls.find(c => c[0] === 'session/rename')[1].request.title, 'BTC under 70k');
  assert.equal(store.get().route.id, 's-new');
  assert.equal(store.get().draft, null);
  store.timers.clear();
});

test("an order card's ✓ answers allowed-once through the mux and the chip reads Approved; a question's Answer sends the batch", async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  h.opts().onGate({ type: 'waterfall', event: 'approval/request', eventId: 'ev-9', agentId: 's1', request: { toolName: 'mcp__alpaca-kit__place_order', callId: 'c9', reason: 'PAPER order - place_order: side=buy' } });
  await settle();
  assert.match(f.html(), /data-action="answer"[^>]*data-value="allowed-once"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'answer', conv: 's1', msg: 'ev-9', value: 'allowed-once' } });
  await settle();
  assert.deepEqual(h.answered, [['ev-9', 'allowed-once']]);
  assert.match(f.html(), /class="chip up">Approved</);
  assert.doesNotMatch(f.html(), /data-action="answer"/);
  h.opts().onGate(frames[7]);
  await settle();
  f.withSelector('input', { tagName: 'INPUT', type: 'radio', name: 'q-ev-2-q1', checked: true, value: 'Yes, pin it' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'answerQuestion', conv: 's1', msg: 'ev-2' } });
  await settle();
  assert.deepEqual(h.answered[1], ['ev-2', { answers: [{ id: 'q1', selected: ['Yes, pin it'] }] }]);
  assert.match(f.html(), />Answered</);
  store.timers.clear();
});

const orderGate = { type: 'waterfall', event: 'approval/request', eventId: 'ev-9', agentId: 's1', request: { toolName: 'mcp__alpaca-kit__place_order', callId: 'c9', reason: 'PAPER order - place_order: side=buy' } };
const approve = f => f.click({ tagName: 'BUTTON', dataset: { action: 'answer', conv: 's1', msg: 'ev-9', value: 'allowed-once' } });

test('a gate this tab answered stays answered: re-opening its conversation or a reconnect never brings its keys back', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { updatedAt: 9, agentAvailable: true }), row('s2', { updatedAt: 5 })] });
  const store = started(f, h);
  await h.ready();
  // the newest follow of s1 delivers its snapshot, as the host does on every open
  const snapshot = () => [...h.streams].reverse().find(x => x.name === 'session/follow' && x.args.request.address.sessionId === 's1' && !x.cancelled).cbs.onItem({ type: 'snapshot', records: [{ event: frames[0].event }] });
  snapshot();
  h.opts().onGate(orderGate);
  await settle();
  approve(f);
  await settle();
  assert.match(f.html(), /class="chip up">Approved</);
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  snapshot();
  await settle();
  assert.doesNotMatch(f.html(), /data-action="answer"/, 're-opened: no keys on a settled gate');
  assert.doesNotMatch(f.html(), /nav-badge/, 're-opened: nothing waits on the operator');
  h.opts().onDown('socket closed');
  h.opts().onReady({});
  await settle();
  snapshot();
  await settle();
  assert.doesNotMatch(f.html(), /data-action="answer"/, 'reconnected: no keys on a settled gate');
  assert.doesNotMatch(f.html(), /nav-badge/);
  store.timers.clear();
});

test("a lost race (the host's cancel trails this tab's resolved answer) relabels the card Settled elsewhere", async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  h.opts().onGate(orderGate);
  await settle();
  approve(f);
  await settle();
  assert.match(f.html(), /class="chip up">Approved</);
  // api.js reports a cancel for a gate this generation already answered: another answer or a Stop settled it first
  h.opts().onGateGone('ev-9');
  await settle();
  assert.match(f.html(), /class="chip grey">Settled elsewhere</);
  assert.doesNotMatch(f.html(), />Approved</);
  store.timers.clear();
});

test("a bare press on a question's Answer sends nothing and says every question needs an answer", async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  h.opts().onGate(frames[7]);
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'answerQuestion', conv: 's1', msg: 'ev-2' } });
  await settle();
  assert.deepEqual(h.answered, [], 'nothing reached the mux');
  assert.match(f.html(), /status-line bad" role="status">Answer every question first</);
  assert.match(f.html(), /data-action="answerQuestion"/, 'the card still waits');
  store.timers.clear();
});

test("a question card's pick, free answer and focus survive a re-render while the operator is still answering", async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  h.opts().onGate(frames[7]);
  await settle();
  const pick = f.withId('q-ev-2-q1-0', { tagName: 'INPUT', type: 'radio', name: 'q-ev-2-q1', value: 'Yes, pin it', presentIf: /id="q-ev-2-q1-0"/ });
  const other = f.withId('q-ev-2-q1-custom', { tagName: 'INPUT', type: 'text', name: 'q-ev-2-q1-custom', presentIf: /id="q-ev-2-q1-custom"/ });
  pick.checked = true;
  other.value = 'and keep the margin';
  other.focus();
  store.dispatch('toggleRail'); // any change re-renders the whole page, as a list refresh does every few seconds
  assert.equal(pick.checked, true, 'the pick survives');
  assert.equal(other.value, 'and keep the margin', 'the free answer survives');
  assert.equal(f.doc.activeElement, other, 'focus stays in the box');
  store.timers.clear();
});

test("the thread keeps the reader's place when a message arrives while they read up; at the bottom it follows the tail", async () => {
  const f = fakeWindow({ hash: '' });
  const thread = f.withId('thread', { scrollHeight: 2000, clientHeight: 400 });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = started(f, h);
  await h.ready();
  const follow = h.streams.find(s => s.name === 'session/follow');
  follow.cbs.onItem({ type: 'snapshot', records: [{ event: frames[0].event }, { event: frames[1].event }] });
  await settle();
  thread.scrollTop = 300; // reading up, 1300 px above the bottom
  follow.cbs.onItem({ type: 'event', event: frames[11].event });
  await settle();
  assert.equal(thread.scrollTop, 300, 'a new message does not yank the reader down');
  thread.scrollTop = 1600; // at the bottom
  follow.cbs.onItem({ type: 'event', event: frames[16].event });
  await settle();
  assert.equal(thread.scrollTop, 2000, 'at the bottom the thread follows the tail');
  store.timers.clear();
});

test('an @ goes through the room route: one that addressed a bot sends nothing more; one that fails says so, sends nothing and keeps the words', async () => {
  const f = fakeWindow({ hash: '' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1')] });
  const getJson = async path => (path === '/data/channels.json' ? { ok: true, root: '/r', channels: [{ workspaceId: 'w1', name: 'room-drill', isRoot: false, sessionIds: ['s1'] }], ungrouped: [], archived: [], presets: {} } : { bots: [] });
  const answers = [{ ok: true, status: 200, body: { ok: true, addressed: ['buffett'] } }, { ok: false, status: 409, body: { ok: false, error: 'channel room-drill has no roster' } }];
  const fetched = [];
  f.win.fetch = async (path, init) => { fetched.push([path, JSON.parse(init.body)]); const a = answers.shift(); return { ok: a.ok, status: a.status, json: async () => a.body }; };
  // no postJson handed in: the page's own, on the window's fetch
  const store = boot(f.win, { openMux: h.openMux, call: h.call, getJson, markdown: null });
  await h.ready();
  for (const words of ['@buffett leverage?', '@buffett and now?']) {
    say.value = words;
    f.fire('root', 'input', { target: say });
    send(f);
    await settle();
  }
  assert.deepEqual(fetched.map(x => x[0]), ['/data/rooms/say', '/data/rooms/say']);
  assert.equal(h.calls.filter(c => c[0] === 'session/prompt').length, 0, 'neither @-line was re-sent to Gravit as a prompt');
  assert.match(f.html(), /status-line bad" role="status">send: channel room-drill has no roster</);
  assert.equal(say.value, '@buffett and now?', 'the failed words stay in the composer');
  store.timers.clear();
});

test('Details opens on its key and takes focus on its close key; Escape closes it and focus returns to the opener', async () => {
  const f = fakeWindow({ hash: '' });
  const details = f.withSelector('[data-action="toggleDetails"]', { tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
  const close = f.withSelector('.drawer .close-key', { tagName: 'BUTTON', presentIf: /class="drawer details"/ });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  details.focus();
  f.click(details);
  assert.match(f.html(), /class="drawer details"/);
  assert.equal(f.doc.activeElement, close);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.doesNotMatch(f.html(), /class="drawer details"/);
  assert.equal(f.doc.activeElement, details);
  store.timers.clear();
});

test('Stop Gravit asks in place and cancels the session on the second press', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { running: true, agentAvailable: true })] });
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'stopGravit', conv: 's1' } });
  assert.match(f.html(), /data-action="confirmYes"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  await settle();
  assert.deepEqual(h.calls.find(c => c[0] === 'session/cancel')[1], { request: { sessionId: 's1' } });
  assert.match(f.html(), /A paused goal resumes with \/goal resume/);
  store.timers.clear();
});

test('nothing re-renders while an IME is composing; the held render runs at compositionend', async () => {
  const f = fakeWindow({ hash: '' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  const before = f.writes;
  f.fire('root', 'compositionstart');
  store.dispatch('toggleRail');
  assert.equal(f.writes, before, 'held');
  f.fire('root', 'compositionend', { target: say });
  assert.equal(f.writes, before + 1);
  store.timers.clear();
});

test('the theme comes from the prefs before the host answers, and a change is written to the prefs', async () => {
  const m = new Map([['gravit-ui.prefs', JSON.stringify({ theme: 'black' })]]);
  const storage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  const f = fakeWindow({ hash: '', storage });
  const h = host();
  const store = started(f, h);
  assert.equal(f.doc.documentElement.dataset.theme, 'black');
  f.click({ tagName: 'BUTTON', dataset: { action: 'setTheme', value: 'Cream' } });
  assert.equal(f.doc.documentElement.dataset.theme, 'cream');
  assert.equal(JSON.parse(m.get('gravit-ui.prefs')).theme, 'cream');
  store.timers.clear();
});

// Markets through host: fake live quotes and search, the browser's storage a memory
function fakeMarkets() {
  const live = { assets: [], visible: [], onUpdate: null };
  const search = { queries: [], onUpdate: null };
  return {
    live, search,
    createLiveQuotes: onUpdate => { live.onUpdate = onUpdate; return { setAssets(a) { live.assets.push(a.map(x => x.id)); }, setVisible(v) { live.visible.push(v); }, refresh() {}, close() {} }; },
    createSymbolSearch: onUpdate => {
      search.onUpdate = onUpdate;
      return { search(q, market) { search.queries.push([q, market]); onUpdate({ query: q.trim(), market, status: q.trim() ? 'loading' : 'idle', assets: [], partial: false, truncated: false, note: '' }); }, cancel() {} };
    },
  };
}
const memoryStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const bootMarkets = (f, h, mk) => boot(f.win, { openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, createLiveQuotes: mk.createLiveQuotes, createSymbolSearch: mk.createSymbolSearch });
const NVDA = { id: 'us:NVDA', market: 'us', symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ', currency: 'USD' };

test("typing in the search box searches; a star watches and writes the face's key; a row opens its page", async () => {
  const storage = memoryStorage();
  const f = fakeWindow({ hash: '#/markets', storage });
  const mq = f.withId('mq', { tagName: 'INPUT', type: 'search', dataset: { action: 'mkQuery' } });
  const h = host();
  const mk = fakeMarkets();
  const store = bootMarkets(f, h, mk);
  await h.ready();
  assert.match(f.html(), /<main class="main mkts">/);
  assert.match(f.html(), /Nothing watched yet/);
  mq.value = 'nvd';
  f.fire('root', 'input', { target: mq });
  assert.deepEqual(mk.search.queries.at(-1), ['nvd', 'all']);
  assert.equal(store.get().markets.q, 'nvd');
  assert.match(f.html(), /Searching…/);
  mk.search.onUpdate({ query: 'nvd', market: 'all', status: 'success', assets: [NVDA], partial: false, truncated: false, note: '' });
  await settle();
  assert.match(f.html(), /<tr data-id="us:NVDA">/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'us:NVDA' } });
  assert.deepEqual(JSON.parse(storage.getItem('gravit.market.watchlist.v1')).items.map(a => [a.id, a.name]), [['us:NVDA', 'NVIDIA']]);
  assert.match(f.html(), /aria-pressed="true" aria-label="Stop watching NVDA"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'us:NVDA' } });
  assert.deepEqual(JSON.parse(storage.getItem('gravit.market.watchlist.v1')).items, [], 'a second press stops watching');
  f.click({ tagName: 'BUTTON', dataset: { action: 'mkClear' } });
  assert.equal(store.get().markets.q, '');
  assert.deepEqual(mk.search.queries.at(-1), ['', 'all']);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openMarket', id: 'us:NVDA' } });
  await settle();
  assert.equal(f.win.location.hash, '#/markets/us:NVDA');
  assert.deepEqual(store.get().route, { screen: 'markets', id: 'us:NVDA' });
  store.timers.clear();
});

// the manual look (2026-10-20): the render keeps what an input holds, so Clear must empty the box itself
test('Clear empties the search box as well as the query', async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const mq = f.withId('mq', { tagName: 'INPUT', type: 'search', dataset: { action: 'mkQuery' } });
  const h = host();
  const store = bootMarkets(f, h, fakeMarkets());
  await h.ready();
  mq.value = 'BTC';
  f.fire('root', 'input', { target: mq });
  assert.equal(mq.value, 'BTC', 'a render keeps what was typed');
  f.click({ tagName: 'BUTTON', dataset: { action: 'mkClear' } });
  assert.equal(store.get().markets.q, '');
  assert.equal(mq.value, '', 'the box is empty too');
  store.timers.clear();
});

test('leaving Markets pauses the quotes and coming back resumes them; a hidden tab pauses them too', async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const h = host({ rows: [row('s1')] });
  const mk = fakeMarkets();
  const store = bootMarkets(f, h, mk);
  await h.ready();
  assert.equal(mk.live.visible.at(-1), true);
  assert.equal(store.get().route.screen, 'markets', 'the list landing does not pull the page to Messages');
  f.win.location.hash = '#/messages/s1';
  await settle();
  assert.equal(mk.live.visible.at(-1), false);
  f.win.location.hash = '#/markets';
  await settle();
  assert.equal(mk.live.visible.at(-1), true);
  f.doc.hidden = true;
  f.fire('doc', 'visibilitychange');
  assert.equal(mk.live.visible.at(-1), false);
  f.doc.hidden = false;
  f.fire('doc', 'visibilitychange');
  assert.equal(mk.live.visible.at(-1), true);
  store.timers.clear();
});

test('#/markets/garbage opens Markets; a lower-case id is written canonical', async () => {
  const f = fakeWindow({ hash: '#/markets/garbage', storage: memoryStorage() });
  const store = bootMarkets(f, host(), fakeMarkets());
  assert.equal(f.win.location.hash, '#/markets');
  assert.deepEqual(store.get().route, { screen: 'markets', id: null });
  assert.match(f.html(), /<h1 class="head-title">Markets<\/h1>/);
  f.win.location.hash = '#/markets/us:aapl';
  await settle();
  assert.equal(f.win.location.hash, '#/markets/us:AAPL');
  store.timers.clear();
});

test('opening a us page reads /data/bars once; a crypto page reads none', async () => {
  const f = fakeWindow({ hash: '#/markets/us:AAPL', storage: memoryStorage() });
  const h = host();
  const reads = [];
  const bars = { ok: true, id: 'us:AAPL', source: 'alpaca', feed: 'iex', as_of: '2026-10-17', rows: [{ date: '2026-10-16', close: 10 }, { date: '2026-10-17', close: 11 }] };
  const getJson = async path => { reads.push(path); return path.startsWith('/data/bars') ? bars : h.getJson(path); };
  const mk = fakeMarkets();
  const store = boot(f.win, { openMux: h.openMux, call: h.call, getJson, postJson: h.postJson, markdown: h.markdown, createLiveQuotes: mk.createLiveQuotes, createSymbolSearch: mk.createSymbolSearch });
  await h.ready();
  const barReads = () => reads.filter(p => p.startsWith('/data/bars'));
  assert.deepEqual(barReads(), ['/data/bars?id=us%3AAAPL&days=120']);
  assert.match(f.html(), /<svg class="mk-chart"/);
  mk.live.onUpdate({ quotes: {}, providers: [], status: 'streaming', refreshing: false, generatedAt: null, note: '', limited: 0 });
  await settle();
  assert.equal(barReads().length, 1, 'a re-render reads nothing');
  f.win.location.hash = '#/markets/crypto:BTC/USD';
  await settle();
  assert.equal(barReads().length, 1, 'a crypto page has no bar source');
  f.win.location.hash = '#/markets/us:AAPL';
  await settle();
  assert.equal(barReads().length, 2, 'opening the page again reads again');
  store.timers.clear();
});

test('Hand to Gravit opens New message with the words in the composer', async () => {
  const storage = memoryStorage();
  storage.setItem('gravit.market.watchlist.v1', JSON.stringify({ version: 1, items: [{ id: 'us:AAPL', market: 'us', symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ', currency: 'USD' }] }));
  const f = fakeWindow({ hash: '#/markets/us:AAPL', storage });
  const say = f.withId('say', { tagName: 'TEXTAREA' });
  const h = host({ rows: [row('s1')] });
  const store = bootMarkets(f, h, fakeMarkets());
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'handToGravit', id: 'us:AAPL' } });
  await settle();
  assert.deepEqual(store.get().route, { screen: 'messages', id: 'new' });
  assert.equal(store.get().draft.where, 'w0', 'the root channel');
  assert.equal(say.value, 'Look at AAPL (Apple)');
  assert.equal(f.doc.activeElement, say);
  store.timers.clear();
});

// Account through host: /data/account.json and the Venues reads, recorded
const KEYED = { ok: true, available: true, host: 'paper-api.alpaca.markets', account: { equity: '123346.11', last_equity: '122011.09', cash: '50000', currency: 'USD' },
  positions: [{ symbol: 'AAPL', asset_class: 'us_equity', qty: '5', market_value: '600', change_today: '0.01' }],
  orders: [{ id: 'o2', symbol: 'AAPL', side: 'buy', qty: '3', filled_qty: '3', filled_avg_price: '189.5', type: 'market', status: 'filled', submitted_at: '2026-10-18T14:00:00Z', filled_at: '2026-10-18T14:00:05Z' }],
  generated_at: '2026-10-19T14:00:00Z' };
function accountHost(opts = {}) {
  const h = host(opts);
  const reads = [];
  const getJson = async path => {
    reads.push(path);
    if (path.startsWith('/data/account.json')) return KEYED;
    if (path.startsWith('/data/seat.json')) return { ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-19T18:40:00.000Z', mode: 'guard', writes: { on: true, capUsd: 100 }, seat: { name: 'Gravit', status: 'admitted', limits: [] }, venues: [], cards: [], others: 0 };
    if (path === '/data/plugins.json') return { mcp: [{ server: 'alpaca-kit', phase: 'active', tools: [{ name: 'mcp__alpaca-kit__place_order', description: '' }] }], agentTools: [], rows: [] };
    if (path.startsWith('/data/quotes')) return { ok: true, generated_at: '2026-10-19T14:30:01Z', quotes: [], providers: [{ id: 'alpaca', market: 'us', status: 'connected', source: 'Alpaca', feed: 'iex', transport: 'stream', message: '' }] };
    return h.getJson(path);
  };
  const call = async (endpoint, args) => (endpoint === 'credentials/describe' ? (h.calls.push([endpoint, args]), { APCA_API_KEY_ID: { configured: true, source: 'env' }, APCA_API_SECRET_KEY: { configured: true, source: 'env' } }) : h.call(endpoint, args));
  return { ...h, getJson, call, reads, accountReads: () => reads.filter(p => p.startsWith('/data/account.json')).length };
}
const bootAccount = (f, h, mk = fakeMarkets()) => boot(f.win, { openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, createLiveQuotes: mk.createLiveQuotes, createSymbolSearch: mk.createSymbolSearch });

test('the account loads at boot and the rail shows the net worth', async () => {
  const f = fakeWindow({ hash: '', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  assert.equal(h.accountReads(), 1);
  assert.equal(store.get().account.status, 'ready');
  assert.match(f.html(), /<span class="account-line">\$123,346\.11<\/span>/);
  store.timers.clear();
});

test('Refresh reloads fresh; entering Account reads again; entering Venues describes, and Refresh there describes again', async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  assert.equal(h.accountReads(), 1, 'boot and entering Account share one flight');
  assert.match(f.html(), /class="networth">\$123,346\.11</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await settle();
  assert.equal(h.accountReads(), 2);
  assert.equal(h.reads.filter(p => p.startsWith('/data/account.json')).at(-1), '/data/account.json?fresh=1', 'Refresh skips the 60 s cache');
  const describes = () => h.calls.filter(c => c[0] === 'credentials/describe').length;
  assert.equal(describes(), 0);
  f.win.location.hash = '#/account/venues';
  await settle();
  assert.equal(describes(), 1);
  assert.equal(h.reads.filter(p => p === '/data/plugins.json').length, 1);
  assert.match(f.html(), /Keys · env · Order tools on/);
  assert.match(f.html(), /Alpaca · Connected/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await settle();
  assert.equal(describes(), 2, 'a refresh on Venues reads the venue facts again too');
  f.win.location.hash = '#/messages/s1';
  await settle();
  f.win.location.hash = '#/account/portfolio';
  await settle();
  assert.equal(h.accountReads(), 4, 'entering Account again reads it again');
  store.timers.clear();
});

test('Export CSV hands the browser a blob with the statement and revokes it', async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const blobs = [];
  const Blob = f.win.Blob;
  f.win.Blob = class extends Blob { constructor(parts, opts) { super(parts, opts); blobs.push(this); } };
  const anchors = [];
  f.doc.createElement = () => { const a = f.element({ tagName: 'A' }); anchors.push(a); return a; };
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'openStatement' } });
  await settle();
  assert.match(f.html(), /aria-label="Statement"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'exportStatement' } });
  await settle();
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, 'text/csv');
  assert.equal(blobs[0].parts.join(''), 'date,side,qty,symbol,price,amount\r\n2026-10-18T14:00:05Z,buy,3,AAPL,189.5,568.5\r\n');
  assert.equal(anchors.at(-1).download, 'statement.csv');
  assert.equal(anchors.at(-1).href, 'blob:fake');
  assert.equal(anchors.at(-1).clicks, 1);
  assert.deepEqual(f.revoked, ['blob:fake']);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().account.statementOpen, false, 'Escape closes the Statement');
  store.timers.clear();
});

test('a receipt in a conversation reloads the account', async () => {
  const f = fakeWindow({ hash: '#/messages/s1', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1', { agentAvailable: true })] });
  const store = bootAccount(f, h);
  await h.ready();
  const before = h.accountReads();
  const follow = [...h.streams].reverse().find(x => x.name === 'session/follow' && x.args.request.address.sessionId === 's1');
  follow.cbs.onItem({ type: 'snapshot', records: [] });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'c9', name: 'mcp__alpaca-kit__place_order', arguments: JSON.stringify({ symbol: 'AAPL', qty: 1, side: 'buy', order_type: 'market' }) } } });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/result', seq: 41, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId: 'c9' }, toolCallId: 'c9', content: [{ type: 'text', text: JSON.stringify({ ok: true, id: 'ord-1' }) }], isError: false } } } });
  await settle();
  assert.equal(h.accountReads(), before + 1);
  assert.equal(h.reads.filter(p => p.startsWith('/data/account.json')).at(-1), '/data/account.json?fresh=1', 'a fill is read past the cache');
  store.timers.clear();
});

// spec 2026-10-20 §6.3: the seat's standing is read on entering Venues, past the cache on Refresh there and after a seat receipt
test('entering Venues reads /data/seat.json; Refresh there reads it fresh; a seat receipt reloads it fresh and not the account', async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1', { agentAvailable: true })] });
  const store = bootAccount(f, h);
  await h.ready();
  const seatReads = () => h.reads.filter(p => p.startsWith('/data/seat.json'));
  assert.deepEqual(seatReads(), ['/data/seat.json'], 'entering Venues reads the seat once');
  assert.equal(store.get().seat.status, 'ready');
  assert.match(f.html(), /127\.0\.0\.1:4820 · reachable/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await settle();
  assert.equal(seatReads().at(-1), '/data/seat.json?fresh=1', 'Refresh on Venues reads the seat past the cache');
  const accountBefore = h.accountReads();
  const seatBefore = seatReads().length;
  f.win.location.hash = '#/messages/s1'; f.fire('win', 'hashchange'); await settle();
  const follow = [...h.streams].reverse().find(x => x.name === 'session/follow' && x.args.request.address.sessionId === 's1');
  follow.cbs.onItem({ type: 'snapshot', records: [] });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 60, time: 1756512300000, data: { turn: 5, step: 1, callId: 'c10', name: 'mcp__account__portfolio_live_order', arguments: JSON.stringify({ venue: 'paper-1', symbol: 'AAPL', side: 'buy', usd: 100 }) } } });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/result', seq: 61, time: 1756512301000, surfaceOp: 'append', data: { turn: 5, step: 1, message: { id: 'm-61', role: 'tool', source: { kind: 'tool', callId: 'c10' }, toolCallId: 'c10', content: [{ type: 'text', text: JSON.stringify({ ok: true, pending: true, card: { id: 'card-0007' } }) }], isError: false } } } });
  await settle();
  assert.equal(seatReads().length, seatBefore + 1, 'a seat receipt reloads the seat');
  assert.equal(seatReads().at(-1), '/data/seat.json?fresh=1');
  assert.equal(h.accountReads(), accountBefore, 'and not the Alpaca account');
  store.timers.clear();
});

test('Open the Statement on a Market page lands on Account with the Statement open', async () => {
  const f = fakeWindow({ hash: '#/markets/us:AAPL', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  assert.match(f.html(), /class="link mk-link" data-action="openStatement">Open the Statement →</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openStatement' } });
  await settle();
  assert.equal(f.win.location.hash, '#/account/portfolio');
  assert.equal(store.get().account.statementOpen, true);
  assert.match(f.html(), /aria-label="Statement"/);
  store.timers.clear();
});

// the final review: the page re-renders on every quote tick, so a click whose press and release straddle a render
// never fires; renders wait while a press is down
test('a press holds renders until it ends, so a streaming quote cannot swallow the click', async () => {
  const storage = memoryStorage();
  storage.setItem('gravit.market.watchlist.v1', JSON.stringify({ version: 1, items: [{ id: 'crypto:BTC/USD', market: 'crypto', symbol: 'BTC/USD', name: 'Bitcoin', exchange: '', currency: 'USD' }] }));
  const f = fakeWindow({ hash: '#/markets', storage });
  const h = host();
  const mk = fakeMarkets();
  const store = boot(f.win, { openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, createLiveQuotes: mk.createLiveQuotes, createSymbolSearch: mk.createSymbolSearch, pointerHoldMs: 20 });
  await h.ready();
  const quote = price => ({ id: 'crypto:BTC/USD', market: 'crypto', symbol: 'BTC/USD', price, prev_close: 1, change: 1, change_pct: 1, volume: 1, as_of: '2026-10-20T14:00:00Z', received_at: null, volume_as_of: null, source: 'Coinbase', feed: 'exchange', basis: '24h', quote_status: 'live', market_status: 'open', message: '' });
  const tick = price => mk.live.onUpdate({ quotes: { 'crypto:BTC/USD': quote(price) }, providers: [], status: 'streaming', refreshing: false, generatedAt: 'x', note: '', limited: 0 });
  const before = f.writes;
  f.fire('root', 'pointerdown', { button: 0 });
  tick(82_000);
  tick(82_001);
  assert.equal(f.writes, before, 'no render while the press is down');
  f.fire('doc', 'pointerup', { button: 0 });
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'crypto:BTC/USD' } });
  assert.deepEqual(store.get().markets.watchlist, [], 'the click ran');
  await settle();
  assert.match(f.html(), /Nothing watched yet/, 'the held render landed');
  const held = f.writes;
  f.fire('root', 'pointerdown', { button: 0 });
  tick(82_002);
  assert.equal(f.writes, held);
  await new Promise(r => setTimeout(r, 40));
  await settle();
  assert.ok(f.writes > held, 'a press that never comes back up lets go after pointerHoldMs');
  const right = f.writes;
  f.fire('root', 'pointerdown', { button: 2 });
  tick(82_003);
  assert.ok(f.writes > right, 'a right press holds nothing');
  store.timers.clear();
});

test('boot opens the newest open conversation when the newest is archived', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { updatedAt: 9 }), row('s2', { updatedAt: 5 })], meta: { ok: true, archived: ['s1'], deleted: [] } });
  const store = started(f, h);
  await h.ready();
  assert.equal(store.get().route.id, 's2');
  assert.equal(store.get().conversations.find(c => c.id === 's1').archived, 'face');
  store.timers.clear();
});

test('Fork opens the new conversation', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'fork', conv: 's1' } });
  await settle();
  assert.deepEqual(h.calls.find(c => c[0] === 'session/fork')[1], { request: { sessionId: 's1' } });
  assert.equal(store.get().route.id, 's-fork');
  assert.equal(f.win.location.hash, '#/messages/s-fork');
  store.timers.clear();
});

test('Delete asks first, then the page moves to the first open conversation', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { updatedAt: 9 }), row('s2', { updatedAt: 5 })] });
  const store = started(f, h);
  await h.ready();
  assert.equal(store.get().route.id, 's1');
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'deleteConv', conv: 's1' } });
  assert.deepEqual(h.posted.filter(p => p[0] === '/data/sessions/delete'), [], 'nothing until the second press');
  assert.match(f.html(), /Yes, delete/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  await settle();
  assert.deepEqual(h.posted.find(p => p[0] === '/data/sessions/delete')[1], { sessionId: 's1' });
  assert.equal(store.get().route.id, 's2');
  assert.equal(store.get().conversations.some(c => c.id === 's1'), false);
  store.timers.clear();
});

test('Archive moves the page to the first open conversation; the archived one stays in the store', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { updatedAt: 9 }), row('s2', { updatedAt: 5 })] });
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'archive', conv: 's1' } });
  await settle();
  assert.deepEqual(h.posted.find(p => p[0] === '/data/sessions/archive')[1], { sessionId: 's1', archived: true });
  assert.equal(store.get().conversations.find(c => c.id === 's1').archived, 'face');
  assert.equal(store.get().route.id, 's2');
  store.timers.clear();
});

test('a conversation deleted elsewhere leaves the screen at the next list', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { updatedAt: 9 }), row('s2', { updatedAt: 5 })] });
  const store = started(f, h);
  await h.ready();
  assert.equal(store.get().route.id, 's1');
  h.rows.splice(0, 1);
  await store.live.refresh();
  await settle();
  assert.equal(store.get().route.id, 's2');
  store.timers.clear();
});

test('deleting the only open conversation stops reading it', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = started(f, h);
  await h.ready();
  const followed = h.streams.find(s => s.name === 'session/follow' && s.args.request.address.sessionId === 's1');
  assert.ok(followed, 'the live conversation is followed');
  f.click({ tagName: 'BUTTON', dataset: { action: 'deleteConv', conv: 's1' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  await settle();
  assert.equal(store.get().route.id, null);
  assert.equal(followed.cancelled, true, 'the follow of the deleted conversation ends');
  store.timers.clear();
});

test('collapsing a group hides its rows and the prefs remember it', async () => {
  const f = fakeWindow({ hash: '', storage: memoryStorage() });
  const h = host({ rows: [row('s1', { updatedAt: 9 }), row('s2', { updatedAt: 5 })] });
  const store = started(f, h);
  await h.ready();
  assert.equal(store.get().route.id, 's1');
  assert.match(f.html(), /data-id="s2"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleGroup', key: '__ungrouped' } });
  assert.doesNotMatch(f.html(), /data-id="s2"/, 'the collapsed group hides its other rows');
  assert.match(f.html(), /data-id="s1"/, 'and keeps the one on screen');
  assert.deepEqual(JSON.parse(f.win.localStorage.getItem('gravit-ui.prefs')).collapsed, { __ungrouped: true });
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleGroup', key: '__ungrouped' } });
  assert.match(f.html(), /data-id="s2"/);
  store.timers.clear();
});

test('a channel header opens its page and reads its overview once', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.win.location.hash = '#/channel/w0';
  f.fire('win', 'hashchange');
  await settle();
  assert.equal(store.get().route.screen, 'channel');
  assert.deepEqual(h.posted.filter(p => p[0] === '/data/channels/overview'), [['/data/channels/overview', { workspaceId: 'w0' }]]);
  assert.match(f.html(), /<main class="main chan">/);
  assert.match(f.html(), /class="rail-rows"/, 'the list stays beside the channel page');
  store.dispatch('toggleRail');
  assert.equal(h.posted.filter(p => p[0] === '/data/channels/overview').length, 1, 'a render reads nothing');
  store.timers.clear();
});

test('New round opens New message with Where on the channel', async () => {
  const f = fakeWindow({ hash: '#/channel/w0' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'newRound', id: 'w0' } });
  assert.equal(store.get().route.id, 'new');
  assert.equal(store.get().draft.where, 'w0');
  store.timers.clear();
});

test('New channel… creates the channel and selects it in Where', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  f.fire('root', 'change', { target: { tagName: 'SELECT', value: '__new', dataset: { action: 'draftWhere' } } });
  assert.equal(store.get().edit.kind, 'newChannel');
  assert.equal(store.get().draft.where, 'w0', 'Where keeps its channel while the name is typed');
  f.withSelector('.inline-edit [name]', { tagName: 'INPUT', name: 'channel', value: 'gamma ray' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'commitEdit' } });
  await settle();
  assert.deepEqual(h.posted.find(p => p[0] === '/data/channels')[1], { name: 'gamma-ray' });
  assert.equal(store.get().edit, null);
  assert.equal(store.get().draft.where, 'w-gamma-ray');
  assert.match(f.html(), /<option value="w-gamma-ray" selected>gamma-ray<\/option>/);
  store.timers.clear();
});

test('the bots editor posts the ticked ids', async () => {
  const f = fakeWindow({ hash: '#/channel/w0' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'editRoster', which: 'bots', id: 'w0' } });
  await settle();
  assert.deepEqual(store.get().edit.ticked, ['buffett']);
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', name: 'roster', value: 'drill-bear', checked: true, dataset: {} } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'commitEdit' } });
  await settle();
  assert.deepEqual(h.posted.find(p => p[0] === '/data/channels/bots')[1], { workspaceId: 'w0', bots: ['buffett', 'drill-bear'] });
  assert.equal(store.get().edit, null);
  store.timers.clear();
});

test('entering Discover reads the four listings once', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  h.reads.length = 0;
  f.win.location.hash = '#/discover';
  await settle();
  assert.equal(store.get().route.screen, 'discover');
  assert.deepEqual(h.reads.filter(p => /plugins|agents|memory|bots/.test(p)).sort(), ['/data/agents.json', '/data/bots.json', '/data/memory.json', '/data/plugins.json']);
  assert.match(f.html(), /pcard-name">alpaca-kit</);
  f.win.location.hash = '#/discover/agents';
  await settle();
  assert.equal(h.reads.filter(p => p === '/data/plugins.json').length, 1, 'moving within Discover reads nothing again');
  store.timers.clear();
});

test('Connect on a found agent posts its bin and the shelf re-reads', async () => {
  const f = fakeWindow({ hash: '#/plugin/agent:claude' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  await settle();
  assert.match(f.html(), /data-action="connectAgent" data-bin="claude"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'connectAgent', bin: 'claude' } });
  await settle();
  assert.deepEqual(h.posted.find(p => p[0] === '/data/agents/connect')[1], { bin: 'claude' });
  assert.match(f.html(), /data-action="disconnectAgent" data-bin="claude"/);
  store.timers.clear();
});

test('Save on the bot page posts and the editor shows the new revision', async () => {
  const f = fakeWindow({ hash: '#/plugin/bot:buffett' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'editBot', id: 'buffett' } });
  await settle();
  assert.match(f.html(), /id="bot-buffett-r1-name"/);
  f.withId('bot-buffett-r1-name', { tagName: 'INPUT', value: 'Buffett II' });
  f.withId('bot-buffett-r1-description', { tagName: 'INPUT', value: 'Holds longer' });
  f.withId('bot-buffett-r1-model', { tagName: 'SELECT', value: '' });
  f.withId('bot-buffett-r1-soul', { tagName: 'TEXTAREA', value: '# B2' });
  f.fire('root', 'submit', { target: { closest: () => ({ dataset: { action: 'saveBot', id: 'buffett' } }) } });
  await settle();
  assert.deepEqual(h.posted.find(p => p[0] === '/data/bots/settings')[1], { id: 'buffett', revision: 'r1', name: 'Buffett II', description: 'Holds longer', model: null, soul: '# B2' });
  assert.equal(store.get().edit, null, 'a saved editor closes');
  assert.match(f.html(), /plug-name">Buffett II</);
  store.timers.clear();
});

test('Create a bot creates it and opens its page', async () => {
  const f = fakeWindow({ hash: '#/discover/create' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  await settle();
  f.withId('nb-name', { tagName: 'INPUT', value: 'Macro' });
  f.withId('nb-id', { tagName: 'INPUT', value: '' });
  f.withId('nb-description', { tagName: 'INPUT', value: '' });
  f.withId('nb-model', { tagName: 'SELECT', value: '' });
  f.withId('nb-soul', { tagName: 'TEXTAREA', value: '' });
  f.fire('root', 'submit', { target: { closest: () => ({ dataset: { action: 'createBot' } }) } });
  await settle();
  assert.deepEqual(h.posted.find(p => p[0] === '/data/bots')[1], { name: 'Macro' });
  assert.equal(f.win.location.hash, '#/plugin/bot:macro');
  assert.match(f.html(), /plug-name">Macro</);
  store.timers.clear();
});

test("Talk to opens the bot's conversation", async () => {
  const f = fakeWindow({ hash: '#/plugin/bot:buffett' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'talkTo', id: 'buffett' } });
  await settle();
  assert.deepEqual(h.calls.find(c => c[0] === 'session/create')[1], { request: { cwd: '/r/bots/buffett/home', agentPreset: 'buffett' } });
  assert.equal(store.get().route.screen, 'messages');
  assert.equal(store.get().route.id, 's-bot');
  store.timers.clear();
});

test('an opened tool row stays open across the next render', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.withSelector('details[id][open]', { tagName: 'DETAILS', id: 'tool-c1', open: true });
  const again = f.withId('tool-c1', { tagName: 'DETAILS', open: false });
  store.dispatch('toggleRail');
  assert.equal(again.open, true, 'the render opens it again by its id');
  store.timers.clear();
});

test("opening Trace reads the member's session without following it", async () => {
  const { memberTurn, memberPage } = await import('./helpers/trace.js');
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('room', { agentAvailable: true })], pages: { m1: memberPage(memberTurn()) } });
  const store = started(f, h);
  await h.ready();
  store.dispatch('hostEvent', { convId: 'room', message: { id: 'e9', seq: 9, at: 1, from: 'buffett', kind: 'text', text: 'Hold', data: { name: 'Buffett', markdown: true, memberSessionId: 'm1', memberTurn: 3 } } });
  assert.match(f.html(), /data-action="openTrace" data-conv="room" data-msg="e9"/);
  f.click({ tagName: 'SUMMARY', dataset: { action: 'openTrace', conv: 'room', msg: 'e9' } });
  await settle();
  assert.ok(h.calls.some(c => c[0] === 'session/page' && c[1].request.address.sessionId === 'm1'));
  assert.equal(h.streams.some(s => s.name === 'session/follow' && s.args.request.address.sessionId === 'm1'), false, 'never followed');
  assert.equal(store.get().traces.room.e9.status, 'ready');
  assert.match(f.html(), /<details id="tool-mc1" class="tool">/);
  store.timers.clear();
});

// the read's first dispatch re-renders inside the click: the browser's own toggle would land on the replaced element
test('one click opens Trace and the render its read starts keeps it open; a second click closes it without a read', async () => {
  const { memberTurn, memberPage } = await import('./helpers/trace.js');
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('room', { agentAvailable: true })], pages: { m1: memberPage(memberTurn()) } });
  const store = started(f, h);
  await h.ready();
  store.dispatch('hostEvent', { convId: 'room', message: { id: 'e9', seq: 9, at: 1, from: 'buffett', kind: 'text', text: 'Hold', data: { name: 'Buffett', markdown: true, memberSessionId: 'm1', memberTurn: 3 } } });
  // the disclosure on the page when the click lands, and the one each render draws in its place
  const clicked = f.withSelector('details[id][open]', { tagName: 'DETAILS', id: 'trace-room-e9', open: false });
  const drawn = f.withId('trace-room-e9', { tagName: 'DETAILS', open: false });
  const summary = details => ({ tagName: 'SUMMARY', parentElement: details, dataset: { action: 'openTrace', conv: 'room', msg: 'e9' } });
  f.click(summary(clicked));
  assert.equal(drawn.open, true, 'open after the render the click started');
  await settle();
  assert.equal(store.get().traces.room.e9.status, 'ready');
  assert.equal(drawn.open, true, 'still open with the steps drawn');
  const reads = h.calls.filter(c => c[0] === 'session/page').length;
  f.click(summary(drawn));
  assert.equal(drawn.open, false, 'a second click closes it');
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'session/page').length, reads, 'closing reads nothing');
  store.timers.clear();
});

test('Stop on a child asks first, then interrupts it', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('p', { agentAvailable: true, updatedAt: 9 }), row('c1', { origin: 'subagent', parentSessionId: 'p', running: true })] });
  const store = started(f, h);
  await h.ready();
  h.streams[0].cbs.onItem({ type: 'projection', sessionId: 'p', key: 'subagentCatalog', value: [{ id: 'c1', createdAt: 1, mode: 'continuable', label: 'Check' }], seq: 4 });
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
  assert.match(f.html(), /data-action="stopChild" data-parent="p" data-child="c1"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'stopChild', parent: 'p', child: 'c1', label: 'Check' } });
  assert.equal(h.calls.some(c => c[0] === 'subagents/interruptByParent'), false, 'nothing until the second press');
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  await settle();
  assert.deepEqual(h.calls.find(c => c[0] === 'subagents/interruptByParent')[1], { childSessionId: 'c1', parentSessionId: 'p', mode: 'continuable' });
  store.timers.clear();
});

test("the bots editor never offers Gravit's own composition as a bot", async () => {
  const f = fakeWindow({ hash: '#/channel/w0' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'editRoster', which: 'bots', id: 'w0' } });
  await settle();
  assert.deepEqual(store.get().edit.choices.map(c => c.value), ['buffett', 'drill-bear'], 'the host presets (gravit and its kairos alias) are no bots');
  store.timers.clear();
});
