// boot() against a fake window and a fake host: what the person sees after the list lands, opening, sending, answering.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot as bootApp, Timers } from '../../client/js/app.js';
import { rowsOf, pairsOf } from '../../client/js/host/market-view.js';
import { kidOf } from '../../client/js/wire/owner-key.js';
import { fakeWindow } from './helpers/fake-dom.js';
import { modulesListing } from './helpers/inventory.js';

// every app booted here has its timers stopped after its test, so one that fails half-way never leaves Markets' polls running
const booted = new Set();
const boot = (...args) => { const store = bootApp(...args); booted.add(store); return store; };
afterEach(() => { for (const store of booted) store.timers.clear(); booted.clear(); });

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
    '/data/modules.json': modulesListing(),
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
  return { openMux: o => { opts = o; return mux; }, call, getJson, postJson, markdown: null, calls, posted, answered, streams, rows, reads, inventory, ready: async () => { opts.onReady({}); await settle(); }, opts: () => opts };
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
  const search = { queries: [], onUpdate: null, cancelled: 0 };
  return {
    live, search,
    createLiveQuotes: onUpdate => { live.onUpdate = onUpdate; return { setAssets(a) { live.assets.push(a.map(x => x.id)); }, setVisible(v) { live.visible.push(v); }, refresh() {}, close() {} }; },
    createSymbolSearch: onUpdate => {
      search.onUpdate = onUpdate;
      return {
        search(q, market) { search.queries.push([q, market]); onUpdate({ query: q.trim(), market, status: q.trim() ? 'loading' : 'idle', assets: [], partial: false, truncated: false, note: '' }); },
        cancel() { search.cancelled++; onUpdate({ query: '', market: 'cn', status: 'idle', assets: [], partial: false, truncated: false, note: '' }); },
      };
    },
  };
}
const memoryStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const bootMarkets = (f, h, mk, more = {}) => boot(f.win, { openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, createLiveQuotes: mk.createLiveQuotes, createSymbolSearch: mk.createSymbolSearch, ...more });
const MOUTAI = { id: 'cn:600519', market: 'cn', symbol: '600519', name: 'Kweichow Moutai', exchange: 'SH', currency: 'CNY' };

// the face's own wire searches and stars the A shares alone: a us: or crypto: market is the Account's
test("typing in the search box searches; a star watches and writes the face's key; a row opens its page", async () => {
  const storage = memoryStorage();
  const f = fakeWindow({ hash: '#/markets', storage });
  const mq = f.withId('mq', { tagName: 'INPUT', type: 'search', dataset: { action: 'mkQuery' } });
  const h = host();
  const mk = fakeMarkets();
  // the search waits for a quiet moment in the box: that wait is held here, and run
  const timers = new HeldTimers(ms => ms === 300);
  const store = bootMarkets(f, h, mk, { timers });
  await h.ready();
  assert.match(f.html(), /<main class="main mkts">/);
  // what the fake host answers to the Account's explore is not an explore answer: nothing to list, and the screen says so
  assert.match(f.html(), /<p class="mk-empty">Markets unavailable<\/p>/);
  mq.value = '600';
  f.fire('root', 'input', { target: mq });
  assert.equal(store.get().markets.q, '600');
  assert.match(f.html(), /Searching…/);
  assert.deepEqual(mk.search.queries, []);
  timers.run(300);
  assert.deepEqual(mk.search.queries.at(-1), ['600', 'cn']);
  mk.search.onUpdate({ query: '600', market: 'cn', status: 'success', assets: [MOUTAI], partial: false, truncated: false, note: '' });
  await settle();
  assert.match(f.html(), /<tr data-id="cn:600519">/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'cn:600519' } });
  assert.deepEqual(JSON.parse(storage.getItem('gravit.market.watchlist.v1')).items.map(a => [a.id, a.name]), [['cn:600519', 'Kweichow Moutai']]);
  assert.match(f.html(), /data-id="cn:600519" aria-pressed="true" aria-label="Stop watching Kweichow Moutai"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'cn:600519' } });
  assert.deepEqual(JSON.parse(storage.getItem('gravit.market.watchlist.v1')).items, [], 'a second press stops watching');
  f.click({ tagName: 'BUTTON', dataset: { action: 'mkClear' } });
  assert.equal(store.get().markets.q, '');
  assert.equal(mk.search.cancelled, 1, 'Clear cancels the search');
  f.click({ tagName: 'BUTTON', dataset: { action: 'openMarket', id: 'cn:600519' } });
  await settle();
  assert.equal(f.win.location.hash, '#/markets/cn:600519');
  assert.deepEqual(store.get().route, { screen: 'markets', id: 'cn:600519' });
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

// the face's daily bars are read by no screen: Markets on screen reads the Account's explore instead; an A share's page is the
// face's own, drawn with no read at all
test('a market page reads no /data/bars, whatever its id; Markets on screen reads the Account', async () => {
  const f = fakeWindow({ hash: '#/markets/cn:600519', storage: memoryStorage() });
  const h = host();
  const reads = [];
  const getJson = async path => { reads.push(path); return h.getJson(path); };
  const mk = fakeMarkets();
  const store = boot(f.win, { openMux: h.openMux, call: h.call, getJson, postJson: h.postJson, markdown: h.markdown, createLiveQuotes: mk.createLiveQuotes, createSymbolSearch: mk.createSymbolSearch });
  await h.ready();
  assert.match(f.html(), /<main class="main mkts mk-page">/);
  assert.ok(reads.includes('/data/account/explore?limit=200'), "Markets on screen reads the Account's explore");
  mk.live.onUpdate({ quotes: {}, providers: [], status: 'streaming', refreshing: false, generatedAt: null, note: '', limited: 0 });
  await settle();
  for (const hash of ['#/markets/crypto:BTC/USD', '#/markets/cn:600519', '#/markets/us:AAPL']) {
    f.win.location.hash = hash;
    await settle();
  }
  assert.deepEqual(reads.filter(p => p.startsWith('/data/bars')), []);
  assert.doesNotMatch(f.html(), /<svg class="mk-chart"/, 'no bars, no daily chart');
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

// Account through host: the Account's reads answered as the stand-in answered them (tests/fixtures/account/) — the page (its
// real money $29,138.10 beside two paper venues), holdings and the paper lens, the curve, the statement, the agents, explore,
// a market's candles and compare rows — and the seat; every read recorded. `answers` replaces a route's answer by its path
// without the query: a body, or a function of the path returning one (or a promise of one)
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const isPage = path => path.split('?')[0] === '/data/account';
const SEAT = { ok: true, url: 'http://127.0.0.1:4820', reachable: true, asOf: '2026-10-19T18:40:00.000Z', mode: 'guard', writes: { on: true, capUsd: 100 }, seat: { name: 'Gravit', status: 'admitted', limits: [] }, venues: [], cards: [], others: 0 };
function standinAnswer(path) {
  const [route, query = ''] = path.split('?');
  const q = new URLSearchParams(query);
  const paper = q.get('paper') === '1';
  switch (route) {
    case '/data/account': return fx('account');
    case '/data/account/holdings': return fx(paper ? 'holdings-paper' : 'holdings');
    case '/data/account/history': return { ...fx(paper ? 'history-paper' : 'history'), range: q.get('range') };
    case '/data/account/statement': return fx('statement');
    case '/data/account/agents': return fx('agents');
    case '/data/account/explore': return fx('explore-all');
    case '/data/account/candles': return { ...fx('candles'), venue: q.get('venue'), symbol: q.get('symbol'), range: q.get('range') };
    case '/data/account/compare': return { ...fx('compare'), base: q.get('base') };
    case '/data/account/quotes': return { ok: true, quotes: [] };
    case '/data/seat.json': return SEAT;
    default: return undefined;
  }
}
function accountHost(opts = {}, { answers = {} } = {}) {
  const h = host(opts);
  const reads = [];
  const getJson = async path => {
    reads.push(path);
    const route = path.split('?')[0];
    if (Object.hasOwn(answers, route)) return typeof answers[route] === 'function' ? answers[route](path) : answers[route];
    return standinAnswer(path) ?? h.getJson(path);
  };
  return { ...h, getJson, reads, accountReads: () => reads.filter(isPage).length };
}
const bootAccount = (f, h, mk = fakeMarkets(), more = {}) => boot(f.win, { openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, createLiveQuotes: mk.createLiveQuotes, createSymbolSearch: mk.createSymbolSearch, ...more });

// the Account's push channel as the app is handed it: its opens, closes and follows recorded, its status the test's to set; the
// app's two callbacks kept, so a test delivers an event or a change of status as the stream would
function fakeStream() {
  const st = { opened: 0, closed: 0, follows: [], status: 'idle', onEvent: null, onStatus: null };
  st.create = (onEvent, onStatus) => {
    st.onEvent = onEvent;
    st.onStatus = onStatus;
    return {
      clientId: 'face-000102030405060708090a0b',
      open() { st.opened += 1; st.set('connecting'); },
      close() { st.closed += 1; st.set('closed'); },
      follow(keys) { st.follows.push([...keys]); },
      status: () => st.status,
    };
  };
  st.set = status => { if (status === st.status) return; st.status = status; st.onStatus(status); };
  st.event = (type, data, id) => st.onEvent({ type, id, data });
  return st;
}

// the app's timers, the polls among them held: a timer the test holds (5 s and longer by default) runs only when the test runs
// it; any other runs as the browser's would
class HeldTimers extends Timers {
  constructor(holds = ms => ms >= 5_000) { super(); this.holds = holds; this.held = new Map(); this.serial = 0; }
  after(ms, fn) {
    if (!this.holds(ms)) return super.after(ms, fn);
    const id = `held-${++this.serial}`;
    this.held.set(id, { ms, fn });
    return id;
  }
  cancel(id) { if (!this.held.delete(id)) super.cancel(id); }
  clear() { this.held.clear(); super.clear(); }
  delays() { return [...this.held.values()].map(t => t.ms).sort((a, b) => a - b); }
  ids() { return [...this.held.keys()]; }
  run(ms) {
    const found = [...this.held].find(([, t]) => t.ms === ms);
    assert.ok(found, `a ${ms} ms timer is held`);
    this.held.delete(found[0]);
    found[1].fn();
  }
}

test('the account loads at boot and the rail shows its net worth', async () => {
  const f = fakeWindow({ hash: '', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  assert.equal(h.accountReads(), 1);
  assert.equal(store.get().account.status, 'ready');
  assert.match(f.html(), /<span class="account-line">\$29,138\.10<\/span>/, "the stand-in's real money leads");
  store.timers.clear();
});

test('Refresh reads the page and the seat past the cache, and the holdings; entering Account reads again', async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  assert.equal(h.accountReads(), 1, 'boot and entering Account share one flight');
  assert.match(f.html(), /class="networth">\$29,138\.10</);
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await settle();
  assert.equal(h.accountReads(), 1);
  assert.equal(h.reads.filter(isPage).at(-1), '/data/account?fresh=1', "Refresh skips the face's cache");
  assert.deepEqual(h.reads.filter(p => !isPage(p)).sort(), ['/data/account/holdings?cost=1', '/data/account/holdings?cost=1&paper=1', '/data/seat.json?fresh=1'],
    'the holdings with their paper lens, and the seat past its cache');
  f.win.location.hash = '#/account/venues';
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await settle();
  assert.equal(h.accountReads(), 2, 'a refresh on Venues reads the page again too');
  f.win.location.hash = '#/messages/s1';
  await settle();
  f.win.location.hash = '#/account/portfolio';
  await settle();
  assert.equal(h.accountReads(), 3, 'entering Account again reads it again');
  store.timers.clear();
});

test('Export CSV hands the browser a blob with the statement and revokes it', async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const blobs = [];
  const Blob = f.win.Blob;
  f.win.Blob = class extends Blob { constructor(parts, opts) { super(parts, opts); blobs.push(this); } };
  const anchors = [];
  f.doc.createElement = () => { const a = f.element({ tagName: 'A' }); anchors.push(a); return a; };
  // the Account's statement, one line of it, as the drawer reads it on opening
  const statement = { ok: true, lines: [{ key: 'order:o2', at: '2026-10-18T14:00:05Z', type: 'trade', kind: 'buy', description: 'Buy 3 AAPL · market · at 189.5', amountUsd: -568.5, status: 'filled', by: 'You' }] };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account/statement': statement } });
  const store = bootAccount(f, h);
  await h.ready();
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'openStatement' } });
  await settle();
  assert.deepEqual(h.reads, ['/data/account/statement'], 'the drawer reads the statement on opening');
  assert.match(f.html(), /aria-label="Statement"/);
  assert.match(f.html(), /Buy 3 AAPL · market · at 189\.5/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'exportStatement' } });
  await settle();
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, 'text/csv');
  assert.equal(blobs[0].parts.join(''), 'date,type,kind,description,amount,fee,status,by\r\n2026-10-18T14:00:05Z,trade,buy,Buy 3 AAPL · market · at 189.5,-568.5,,filled,You\r\n');
  assert.equal(anchors.at(-1).download, 'statement.csv');
  assert.equal(anchors.at(-1).href, 'blob:fake');
  assert.equal(anchors.at(-1).clicks, 1);
  assert.deepEqual(f.revoked, ['blob:fake']);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().account.statementOpen, false, 'Escape closes the Statement');
  store.timers.clear();
});

test("an old session's place_order result in a conversation is no receipt: the account is not read again", async () => {
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
  assert.equal(h.accountReads(), before, 'the alpaca half left: its result lifts no receipt (a seat receipt reloads it, below)');
  store.timers.clear();
});

// spec 2026-10-20 §6.3: the seat's standing is read on entering Venues, past the cache on Refresh there and after a seat receipt;
// spec 2026-10-22 §6.2: the Account's page is read after a seat receipt too
test("entering Venues reads /data/seat.json; Refresh there reads it fresh; a seat receipt reloads it and the Account's page fresh", async () => {
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
  assert.equal(h.accountReads(), accountBefore + 1, "and the Account's page");
  assert.equal(h.reads.filter(isPage).at(-1), '/data/account?fresh=1', 'past the cache');
  store.timers.clear();
});

test('Open the Statement on a Market page lands on Account with the Statement open', async () => {
  // a market's page is the Account's: the host answers its explore with the stand-in's
  const f = fakeWindow({ hash: '#/markets/coin:BTC', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  assert.equal(store.get().route.id, 'coin:BTC');
  // the deep link read what is held before the page named its paper venues: the paper lens followed once it did, so You hold
  // and On the statement are drawn from their reads, not Loading…
  assert.deepEqual(h.reads.filter(p => p.startsWith('/data/account/holdings')), ['/data/account/holdings?cost=1', '/data/account/holdings?cost=1&paper=1']);
  assert.match(f.html(), /0\.124 BTC · \$7,747\.40/);
  assert.ok(h.reads.includes('/data/account/statement'));
  assert.doesNotMatch(f.html(), /Loading…/);
  assert.match(f.html(), /class="link mk-link" data-action="openStatement">Open the Statement →</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openStatement' } });
  await settle();
  assert.equal(f.win.location.hash, '#/account/portfolio');
  assert.equal(store.get().account.statementOpen, true);
  assert.match(f.html(), /aria-label="Statement"/);
  store.timers.clear();
});

// the wiring of the Account graft (spec 2026-10-22 §6.1–6.2): the stream, the polls, the tabs' reads, a market's page

test("the Account's stream opens at boot, closes while the tab is hidden and opens again; its events are the reads they name", async () => {
  const f = fakeWindow({ hash: '#/messages/s1', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const st = fakeStream();
  const store = bootAccount(f, h, fakeMarkets(), { createAccountStream: st.create });
  await h.ready();
  assert.deepEqual([st.opened, st.closed], [1, 0], 'opened at boot');
  f.doc.hidden = true;
  f.fire('doc', 'visibilitychange');
  assert.deepEqual([st.opened, st.closed], [1, 1], 'a hidden tab closes its stream');
  f.doc.hidden = false;
  f.fire('doc', 'visibilitychange');
  assert.deepEqual([st.opened, st.closed], [2, 1], 'and opens it again on its return');
  // a fill: the holdings and the page past the face's cache
  h.reads.length = 0;
  st.event('fill', { id: 'fill-1', venue: 'ex' }, 'r.1');
  await settle();
  assert.deepEqual([...h.reads].sort(), ['/data/account/holdings?cost=1&fresh=1', '/data/account/holdings?cost=1&paper=1&fresh=1', '/data/account?fresh=1']);
  // a quote: the price of the market a page follows
  st.event('quote', { venue: 'ex', symbol: 'BTC/USDT', last: 63000.5, priceAt: '2026-10-22T08:00:00.000Z', from: 'Stand-in Exchange · live', live: true }, 'r.2');
  assert.equal(store.get().markets.accountQuotes['ex|BTC/USDT'].price, 63000.5);
  assert.equal(store.get().markets.accountQuotes['ex|BTC/USDT'].quoteFrom, 'Stand-in Exchange · live');
  // a snapshot (a reconnect past the Account's ring): every account read runs again, and the prices the stream kept go — market
  // events are never resumed, so a kept one may be dead — while the quotes poll's stay
  store.dispatch('accountQuotesLoaded', { quotes: [{ venue: 'broker', symbol: 'NVDA', market: { price: 182.4, quoteAt: '2026-10-22T07:59:58.000Z' } }] });
  h.reads.length = 0;
  st.event('snapshot', { at: 'r.5', orders: [] }, 'r.5');
  assert.equal(Object.hasOwn(store.get().markets.accountQuotes, 'ex|BTC/USDT'), false, "the stream's price is gone");
  assert.equal(store.get().markets.accountQuotes['broker|NVDA'].price, 182.4, "the poll's stays");
  await settle();
  for (const read of ['/data/account?fresh=1', '/data/account/statement?fresh=1', '/data/account/agents']) assert.ok(h.reads.includes(read), read);
  // a card raised or answered: the page and the seat box, both past their caches; something else waiting on the owner: the page
  h.reads.length = 0;
  st.event('card', { id: 'card-0002', venue: 'ex', outcome: 'approved', at: '2026-10-22T08:00:01.000Z' }, 'r.3');
  await settle();
  assert.deepEqual([...h.reads].sort(), ['/data/account?fresh=1', '/data/seat.json?fresh=1']);
  h.reads.length = 0;
  st.event('card', { waits: 'letIn', venue: 'ex', at: '2026-10-22T08:00:02.000Z' }, 'r.4');
  await settle();
  assert.deepEqual(h.reads, ['/data/account?fresh=1'], 'no seat read for what waits that is not a card');
  store.timers.clear();
});

test('the Account page is read every 20 s while Account is on screen in a visible tab, 80 s while the stream is open, and never otherwise', async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const st = fakeStream();
  const timers = new HeldTimers();
  const store = bootAccount(f, h, fakeMarkets(), { createAccountStream: st.create, timers });
  await h.ready();
  assert.deepEqual(timers.delays(), [20_000], 'on screen, the stream connecting: every 20 s');
  st.set('open');
  assert.deepEqual(timers.delays(), [80_000], 'the stream open: the interval armed again, at 80 s');
  st.set('stale');
  assert.deepEqual(timers.delays(), [20_000], 'quiet: 20 s again');
  const armed = timers.ids();
  st.set('connecting');
  st.set('closed');
  assert.deepEqual(timers.ids(), armed, 'a change that is not to or from open leaves the interval running');
  h.reads.length = 0;
  timers.run(20_000);
  await settle();
  assert.deepEqual(h.reads.filter(isPage), ['/data/account'], 'a beat reads the page, plain');
  assert.deepEqual(timers.delays(), [20_000], 'and arms the next');
  // a hidden tab reads nothing; a stream that changes meanwhile arms nothing
  f.doc.hidden = true;
  f.fire('doc', 'visibilitychange');
  assert.deepEqual(timers.delays(), []);
  st.set('open');
  st.set('closed');
  assert.deepEqual(timers.delays(), []);
  f.doc.hidden = false;
  f.fire('doc', 'visibilitychange');
  assert.deepEqual(timers.delays(), [20_000]);
  // off screen, never
  f.win.location.hash = '#/messages/s1';
  await settle();
  assert.deepEqual(timers.delays(), []);
  st.set('open');
  assert.deepEqual(timers.delays(), [], 'a stream that opens off screen arms nothing');
  f.win.location.hash = '#/account/portfolio';
  await settle();
  assert.deepEqual(timers.delays(), [80_000], 'back on screen with the stream open: 80 s');
  store.timers.clear();
});

test('each Account tab reads what it draws on entering it: Portfolio the holdings, then the curve; Agents the agents and the seat; Cards the page past the cache', async () => {
  const f = fakeWindow({ hash: '#/messages/s1', storage: memoryStorage() });
  let release = null;
  const h = accountHost({ rows: [row('s1')] }, {
    answers: { '/data/account/holdings': path => (release === null ? standinAnswer(path) : new Promise(res => { const was = release; release = () => { was(); res(standinAnswer(path)); }; })) },
  });
  const store = bootAccount(f, h);
  await h.ready();
  // Portfolio: the page, the holdings with their paper lens — and the curve only once they have landed
  h.reads.length = 0;
  release = () => {};
  f.win.location.hash = '#/account/portfolio';
  await settle();
  assert.deepEqual(h.reads, ['/data/account', '/data/account/holdings?cost=1', '/data/account/holdings?cost=1&paper=1'], 'no curve before the holdings');
  release();
  release = null;
  await settle();
  assert.deepEqual(h.reads.slice(3), ['/data/account/history?range=1d'], 'the leading curve, after them');
  assert.equal(store.get().account.history.status, 'ready');
  // Agents: the Account's agents and the seat, whose row leads
  h.reads.length = 0;
  f.win.location.hash = '#/account/agents';
  await settle();
  assert.deepEqual([...h.reads].sort(), ['/data/account/agents', '/data/seat.json']);
  // Cards: the page past the face's cache, what waits being the page's
  h.reads.length = 0;
  f.win.location.hash = '#/account/cards';
  await settle();
  assert.deepEqual(h.reads, ['/data/account?fresh=1']);
  // Venues: the seat box, nothing more
  h.reads.length = 0;
  f.win.location.hash = '#/account/venues';
  await settle();
  assert.deepEqual(h.reads, ['/data/seat.json']);
  // entering Account on Cards reads the page once, past the cache
  f.win.location.hash = '#/messages/s1';
  await settle();
  h.reads.length = 0;
  f.win.location.hash = '#/account/cards';
  await settle();
  assert.deepEqual(h.reads, ['/data/account?fresh=1']);
  store.timers.clear();
});

test("a range reads its curve; a venue's Details opens a drawer that takes focus, and Escape closes it back to its opener", async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const opener = f.withSelector('[data-action="openVenueDetails"][data-id="ex"]', { tagName: 'BUTTON', dataset: { action: 'openVenueDetails', id: 'ex' } });
  const close = f.withSelector('.drawer .close-key', { tagName: 'BUTTON', presentIf: /aria-label="Venue details"/ });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'setHistoryRange', value: '1w' } });
  await settle();
  assert.deepEqual(h.reads, ['/data/account/history?range=1w']);
  assert.equal(store.get().account.history.range, '1w');
  assert.equal(store.get().account.history.status, 'ready');
  assert.match(f.html(), /aria-pressed="true" data-action="setHistoryRange" data-value="1w"/);
  f.win.location.hash = '#/account/venues';
  await settle();
  opener.focus();
  f.click(opener);
  assert.equal(store.get().account.detailsVenue, 'ex');
  assert.match(f.html(), /<aside class="drawer" aria-label="Venue details"><div class="drawer-head"><h2>Stand-in Exchange<\/h2>/);
  assert.equal(f.doc.activeElement, close, 'the drawer takes focus');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().account.detailsVenue, null, 'Escape closes it');
  assert.doesNotMatch(f.html(), /aria-label="Venue details"/);
  assert.equal(f.doc.activeElement, opener, 'focus returns to its opener');
  f.click(opener);
  f.click({ tagName: 'BUTTON', dataset: { action: 'closeVenueDetails' } });
  assert.equal(store.get().account.detailsVenue, null, '× closes it too');
  store.timers.clear();
});

test("a market's page follows its market on the stream and reads what is held of it and the statement; a range reads candles; leaving lets the follow go", async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const st = fakeStream();
  const store = bootAccount(f, h, fakeMarkets(), { createAccountStream: st.create });
  await h.ready();
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'openMarket', id: 'coin:BTC' } });
  await settle();
  assert.deepEqual(store.get().route, { screen: 'markets', id: 'coin:BTC' });
  assert.deepEqual(st.follows.at(-1), ['ex:BTC/USDT'], 'its first connected line');
  for (const read of ['/data/account/holdings?cost=1', '/data/account/holdings?cost=1&paper=1', '/data/account/statement', '/data/account/candles?venue=ex&symbol=BTC%2FUSDT&range=1D', '/data/account/compare?base=BTC&side=buy']) {
    assert.ok(h.reads.includes(read), read);
  }
  // what is held of it and the statement's lines about it, from their own reads
  assert.match(f.html(), /0\.124 BTC · \$7,747\.40/);
  assert.doesNotMatch(f.html(), /Loading…/);
  // a range: its candles
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'setRange', id: 'coin:BTC', value: '1M' } });
  await settle();
  assert.deepEqual(h.reads, ['/data/account/candles?venue=ex&symbol=BTC%2FUSDT&range=1M']);
  assert.equal(store.get().markets.candles['coin:BTC'].range, '1M');
  // leaving the page lets its market go
  f.win.location.hash = '#/markets';
  await settle();
  assert.deepEqual(st.follows.at(-1), []);
  const follows = st.follows.length;
  f.win.location.hash = '#/messages/s1';
  await settle();
  assert.equal(st.follows.length, follows, 'nothing more to let go');
  store.timers.clear();
});

test("a star on an Account market goes to the Account's own store and comes off in one press, an old star's find too; Remove forgets an old star not listed", async () => {
  // an old us: star the Account lists (its explore answers stock:NVDA for NVDA) and one it does not; the Account's store full, so
  // the found star stays on the cn list, starred as its key
  const storage = memoryStorage();
  const full = Array.from({ length: 100 }, (_, i) => `coin:C${i}`);
  storage.setItem('gravit.market.watchlist.v1', JSON.stringify({ version: 1, items: [{ id: 'us:NVDA', market: 'us', symbol: 'NVDA', name: 'NVIDIA', exchange: '', currency: 'USD' }, { id: 'us:ZZZZ', market: 'us', symbol: 'ZZZZ', name: 'Zed', exchange: '', currency: 'USD' }] }));
  storage.setItem('gravit.account.watch.v1', JSON.stringify({ version: 1, items: full }));
  const f = fakeWindow({ hash: '#/markets', storage });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h);
  await h.ready();
  const m = () => store.get().markets;
  assert.equal(m().asked['us:NVDA'], 'stock:NVDA', 'found at the Account');
  assert.equal(m().asked['us:ZZZZ'], null, 'not listed there');
  assert.ok(m().watchlist.some(a => a.id === 'us:NVDA'), "the Account's store full: the found star stays on the cn list");
  // one press takes it off: the old star with it
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'stock:NVDA' } });
  assert.equal(m().watchlist.some(a => a.id === 'us:NVDA'), false);
  assert.equal(m().watch.includes('stock:NVDA'), false);
  // Remove on the star the Account does not list: it goes, and what it was asked as with it
  f.click({ tagName: 'BUTTON', dataset: { action: 'removeAsked', id: 'us:ZZZZ' } });
  assert.deepEqual(m().watchlist, []);
  assert.equal(Object.hasOwn(m().asked, 'us:ZZZZ'), false);
  // a star on an Account key with room: on, then off
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'coin:C0' } });
  assert.equal(m().watch.includes('coin:C0'), false, 'a starred key comes off');
  // (coin:ETH: the page's own watch list names BTC, whose star is drawn on and comes off nothing on a page that does not sign)
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'coin:ETH' } });
  assert.equal(m().watch.at(-1), 'coin:ETH', 'and an unstarred one goes on, into the room made');
  assert.deepEqual(JSON.parse(storage.getItem('gravit.account.watch.v1')).items.at(-1), 'coin:ETH', "written to the Account's own store");
  store.timers.clear();
});

// spec §6.1: a market's page follows its market on the stream and polls quotes for the rest — the page's own market rides the
// quotes poll, beside the follow, for a market the Account does not stream or a stream that is down
test("the quotes poll asks for the table's rows drawn, and on a market's page for its own market", async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  for (const id of ['coin:BTC', 'stock:NVDA']) f.withSelector('tr[data-id]', { tagName: 'TR', dataset: { id }, presentIf: /<table class="mk-t">/ });
  const h = accountHost({ rows: [row('s1')] });
  const timers = new HeldTimers();
  const store = bootAccount(f, h, fakeMarkets(), { timers });
  await h.ready();
  const m = store.get().markets;
  const quoted = () => h.reads.filter(p => p.startsWith('/data/account/quotes?')).map(p => new URLSearchParams(p.split('?')[1]).get('pairs').split(',').sort());
  const drawn = rowsOf(m, Date.now()).filter(r => r.id === 'coin:BTC' || r.id === 'stock:NVDA');
  timers.run(5_000);
  await settle();
  assert.deepEqual(quoted(), [[...new Set(pairsOf(drawn, 12))].sort()], 'the two rows drawn, their pairs alone');
  f.click({ tagName: 'BUTTON', dataset: { action: 'openMarket', id: 'coin:BTC' } });
  await settle();
  h.reads.length = 0;
  timers.run(5_000);
  await settle();
  assert.deepEqual(quoted(), [['ex|BTC/USDT']], "the page's own market, at its most traded connected line");
  // back on the table, its rows again
  f.win.location.hash = '#/markets';
  await settle();
  h.reads.length = 0;
  timers.run(5_000);
  await settle();
  assert.deepEqual(quoted(), [[...new Set(pairsOf(drawn, 12))].sort()]);
  store.timers.clear();
});

test('the search box moves the query at once and searches after 300 ms of quiet: a keystroke restarts the wait; Clear searches blank at once', async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const mq = f.withId('mq', { tagName: 'INPUT', type: 'search', dataset: { action: 'mkQuery' } });
  const h = accountHost({ rows: [row('s1')] });
  const mk = fakeMarkets();
  const timers = new HeldTimers(ms => ms >= 5_000 || ms === 300);
  const store = bootAccount(f, h, mk, { timers });
  await h.ready();
  const searched = () => h.reads.filter(p => p.startsWith('/data/account/explore?q='));
  mq.value = 'BT';
  f.fire('root', 'input', { target: mq });
  assert.equal(store.get().markets.q, 'BT', 'the query moves at once');
  assert.equal(store.get().markets.tab, 'results');
  assert.deepEqual([searched(), mk.search.queries], [[], []], 'nothing searched yet');
  const first = timers.ids().filter(id => timers.held.get(id).ms === 300);
  mq.value = 'BTC';
  f.fire('root', 'input', { target: mq });
  const second = timers.ids().filter(id => timers.held.get(id).ms === 300);
  assert.equal(second.length, 1, 'one wait at a time');
  assert.notDeepEqual(second, first, 'a keystroke restarts it');
  timers.run(300);
  await settle();
  assert.deepEqual(searched(), ['/data/account/explore?q=BTC&limit=200'], "the Account's search, once, for what was typed last");
  assert.deepEqual(mk.search.queries, [['BTC', 'cn']], 'and the A-share search');
  // a wait cut short by Clear: the search goes blank at once, and the wait never searches
  mq.value = 'ETH';
  f.fire('root', 'input', { target: mq });
  f.click({ tagName: 'BUTTON', dataset: { action: 'mkClear' } });
  assert.equal(store.get().markets.q, '');
  assert.equal(mq.value, '');
  assert.equal(timers.delays().includes(300), false, 'the wait is cancelled');
  assert.equal(mk.search.cancelled, 1, 'the A-share search cancelled');
  assert.equal(searched().length, 1, 'ETH never searched');
  // a box emptied by hand searches blank at once too
  mq.value = 'SOL';
  f.fire('root', 'input', { target: mq });
  mq.value = '';
  f.fire('root', 'input', { target: mq });
  assert.equal(timers.delays().includes(300), false);
  assert.equal(mk.search.cancelled, 2);
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
  // the old star is a star: Watching is among the tabs until it goes
  assert.match(f.html(), /data-action="mkTab" data-value="watching"/);
  const before = f.writes;
  f.fire('root', 'pointerdown', { button: 0 });
  tick(82_000);
  tick(82_001);
  assert.equal(f.writes, before, 'no render while the press is down');
  f.fire('doc', 'pointerup', { button: 0 });
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'crypto:BTC/USD' } });
  assert.deepEqual(store.get().markets.watchlist, [], 'the click ran');
  await settle();
  assert.doesNotMatch(f.html(), /data-value="watching"/, 'the held render landed');
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

test('entering Discover reads the five listings once', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  h.reads.length = 0;
  f.win.location.hash = '#/discover';
  await settle();
  assert.equal(store.get().route.screen, 'discover');
  assert.deepEqual(h.reads.filter(p => /plugins|agents|memory|bots|modules/.test(p)).sort(), ['/data/agents.json', '/data/bots.json', '/data/memory.json', '/data/modules.json', '/data/plugins.json']);
  assert.match(f.html(), /pcard-name">alpaca-kit</);
  f.win.location.hash = '#/discover/agents';
  await settle();
  assert.equal(h.reads.filter(p => p === '/data/plugins.json').length, 1, 'moving within Discover reads nothing again');
  store.timers.clear();
});

test('Discover draws the Research shelf: six module cards with their chips, Run disabled; rows not mounted dims them', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.win.location.hash = '#/discover';
  await settle();
  const html = f.html();
  assert.equal(html.match(/class="pcard research in-grid"/g)?.length, 6);
  assert.match(html, /Lunhui · 6 modules/);
  for (const chip of ['WEAK · STABLE', 'IGNITION · POSITIVE · NONE', 'not evaluable · boards', 'lunhui-s01-repair · no candidate', 'lunhui-s01-repair · WAIT', 'lunhui-s01-repair · 5 items']) assert.ok(html.includes(`>${chip}</span>`), chip);
  assert.match(html, /href="#\/module\/theme"/);
  const runs = html.match(/<button[^>]*data-action="runModule"[^>]*>/g) ?? [];
  assert.equal(runs.length, 6);
  assert.ok(runs.every(b => /\bdisabled\b/.test(b)), 'Run is disabled until plan 3');
  assert.doesNotMatch(html, /Lunhui rows not mounted/);
  h.inventory['/data/modules.json'] = { ...modulesListing(), mounted: false };
  f.click({ tagName: 'BUTTON', dataset: { action: 'shelfRetry', shelf: 'modules' } });
  await settle();
  assert.match(f.html(), /Lunhui rows not mounted/);
  assert.equal(f.html().match(/class="pcard research in-grid dim"/g)?.length, 6);
  assert.ok(f.html().includes('>WEAK · STABLE</span>'), 'a dim card still shows its last headline');
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

// ── the owner device, its sheets and Trade, wired (plan 2 Task 13) ──

// waits on what the real owner device does off the test's clock (the browser's own crypto: a key made, its kid, a signature)
const until = async (cond, what = 'the condition') => {
  for (let i = 0; i < 400; i++) { if (cond()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail(`timed out waiting for ${what}`);
};
// any draft prepared as the Account prepares one: its action with a nonce, the fields it shows
let nonces = 0;
const preparationOf = draft => ({
  ok: true, action: { ...draft, nonce: ++nonces }, primaryType: 'AccountTransaction:Test',
  domain: { name: 'AgentAccountSignTransaction', version: '1', chainId: 424242 }, accountChain: 'Simulation',
  shown: Object.entries(draft).map(([name, value]) => ({ name, value: String(value) })),
});
// the owner door as the face's proxy answers the page's owner device (host/owner.js posts through it): pair names this page's key
// by the kid of the jwk it sends — an owner, or a page that needs the code until one is typed; prepare prepares any draft;
// exchange takes it. Its page is the stand-in's with the knocking keys given, naming this device among the owners once it is one
function ownerDoor({ role = 'owner', requests = [], exchange = () => ({ ok: true, kind: 'result', result: { ok: true } }) } = {}) {
  const door = { posts: [], kid: null, role };
  door.post = async (path, body) => {
    door.posts.push([path, body]);
    if (path === '/data/account/pair') {
      door.kid = await kidOf(globalThis.crypto.subtle, body.jwk);
      if (body.code) door.role = 'owner';
      return { status: 200, body: { ok: true, kid: door.kid, role: door.role } };
    }
    if (path === '/data/account/prepare') return { status: 200, body: preparationOf(body.draft) };
    if (path === '/data/account/exchange') return { status: 200, body: exchange(body.action) };
    return { status: 404, body: { ok: false, error: 'no such route' } };
  };
  door.page = () => {
    const p = { ...fx('account'), requests };
    if (door.kid && door.role === 'owner') p.signers = { ...p.signers, owners: [...p.signers.owners, { id: `device:${door.kid}`, kind: 'device', label: 'Gravit face' }] };
    return p;
  };
  door.sent = path => door.posts.filter(([p]) => p === path).map(([, b]) => b);
  return door;
}
const bootOwner = (f, h, door, mk = fakeMarkets(), more = {}) => bootAccount(f, h, mk, { ownerPost: door.post, ...more });
const signs = store => () => store.get().owner.role === 'signs';
const KEY = '0x' + 'ab'.repeat(20);

test('boot pairs this page once, after the first page lands; a page naming it signs, and later pages pair no more', async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  assert.deepEqual(door.posts, [], 'nothing pairs before a page lands');
  await h.ready();
  await until(signs(store), 'the page to sign');
  assert.equal(door.sent('/data/account/pair').length, 1);
  assert.equal(store.get().owner.kid, door.kid);
  assert.match(f.html(), /This page signs for the account/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await settle();
  assert.equal(door.sent('/data/account/pair').length, 1, 'once');
  assert.equal(store.get().owner.role, 'signs');
  store.timers.clear();
});

test("the pair box's code reaches the door: a page that needs the code pairs with the one typed", async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const box = f.withId('pair-code', { tagName: 'INPUT' });
  const door = ownerDoor({ role: 'needs-code' });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(() => store.get().owner.role === 'needs-code', 'the page to need the code');
  assert.match(f.html(), /<input id="pair-code"/);
  box.value = ' 4F7Q-2KDA ';
  f.click({ tagName: 'BUTTON', dataset: { action: 'pairDevice' } });
  await until(signs(store), 'the page to sign');
  assert.equal(door.sent('/data/account/pair').at(-1).code, '4F7Q-2KDA');
  store.timers.clear();
});

test("Enter in the pair box pairs: the box is a form, and its submit reaches the door with the code typed, once", async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const box = f.withId('pair-code', { tagName: 'INPUT' });
  const door = ownerDoor({ role: 'needs-code' });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(() => store.get().owner.role === 'needs-code', 'the page to need the code');
  assert.match(f.html(), /<form class="pair-box" data-action="pairDevice"[^>]*><input id="pair-code"/);
  const before = door.sent('/data/account/pair').length;
  box.value = ' 4F7Q-2KDA ';
  // Enter in a form's one text box submits the form; the submit's target is the box, its form the pair form
  const enter = () => f.fire('root', 'submit', { target: { tagName: 'INPUT', id: 'pair-code', closest: () => ({ tagName: 'FORM', dataset: { action: 'pairDevice' } }) } });
  // while a pairing is in the air Enter is held, as the Pair key is
  store.dispatch('ownerBusy', true);
  enter();
  await settle();
  assert.equal(door.sent('/data/account/pair').length, before, 'held while busy');
  store.dispatch('ownerBusy', false);
  enter();
  await until(signs(store), 'the page to sign');
  assert.equal(door.sent('/data/account/pair').length, before + 1, 'one pairing for one Enter');
  assert.equal(door.sent('/data/account/pair').at(-1).code, '4F7Q-2KDA');
  store.timers.clear();
});

test('Let in… opens the sheet on the knocking key; a field change prepares again after the quiet; Sign signs it; done reads the page, the holdings, the statement and the seat fresh and closes the sheet', async () => {
  const f = fakeWindow({ hash: '#/account/agents', storage: memoryStorage() });
  const timers = new HeldTimers(ms => ms >= 300);
  const door = ownerDoor({ requests: [{ address: KEY, name: 'Codex', at: '2026-10-22T07:59:00.000Z' }] });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door, fakeMarkets(), { timers });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="openSheet" data-kind="letIn" data-address="0xabab[^"]*" data-name="Codex">Let in…</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'letIn', address: KEY, name: 'Codex' } });
  assert.equal(store.get().sheet.kind, 'letIn');
  assert.deepEqual(store.get().sheet.seed, { address: KEY, name: 'Codex' }, "the knocking key's seed");
  await until(() => store.get().sheet.status === 'ready', 'the preparation');
  const [first] = door.sent('/data/account/prepare');
  assert.deepEqual({ ...first.draft, validUntil: typeof first.draft.validUntil }, { type: 'approveAgent', agentAddress: KEY, agentName: 'Codex', validUntil: 'number' });
  assert.match(f.html(), /<aside class="drawer sheet" aria-label="Let Codex in">/, 'the sheet is drawn in the screen');
  // a field typed: the form takes it at once, the ask after the quiet
  f.fire('root', 'input', { target: { tagName: 'INPUT', type: 'text', name: 'name', value: 'Codex CLI', dataset: { action: 'sheetField' } } });
  assert.equal(store.get().sheet.fields.find(x => x.name === 'name').value, 'Codex CLI');
  assert.equal(door.sent('/data/account/prepare').length, 1, 'nothing asked before the quiet');
  timers.run(300);
  await until(() => door.sent('/data/account/prepare').length === 2 && store.get().sheet.status === 'ready', 'the second preparation');
  assert.equal(door.sent('/data/account/prepare')[1].draft.agentName, 'Codex CLI');
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().sheet === null, 'the done sheet to close');
  const [signed] = door.sent('/data/account/exchange');
  assert.equal(signed.action.agentName, 'Codex CLI');
  assert.equal(signed.signature.kid, door.kid);
  await settle();
  for (const read of ['/data/account?fresh=1', '/data/account/holdings?cost=1&fresh=1', '/data/account/statement?fresh=1', '/data/seat.json?fresh=1']) assert.ok(h.reads.includes(read), read);
  store.timers.clear();
});

test('Grant opens the limit sheet on the ask, Decline its own, Revoke… asks twice; Escape closes the sheet; a page that does not sign opens none', async () => {
  const f = fakeWindow({ hash: '#/account/cards', storage: memoryStorage() });
  // the sheet's close key, its focus counted (the renders after it, asking and prepared, keep it by its action in a browser)
  let focused = 0;
  f.withSelector('.drawer.sheet .close-key', { tagName: 'BUTTON', presentIf: /class="drawer sheet"/, focus() { focused += 1; } });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  f.click({ tagName: 'BUTTON', dataset: { action: 'grant', ask: 'ask-0001' } });
  assert.equal(store.get().sheet.kind, 'limit');
  assert.equal(store.get().sheet.seed.address, '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6');
  assert.deepEqual([store.get().sheet.seed.asked, store.get().sheet.seed.budget], ['ex', '1000'], 'the asked venue and dollars');
  assert.equal(focused, 1, 'the sheet takes focus on its close key as it opens');
  // a pick's boxes: each ticked or unticked as it is checked, the pick's values in its own order
  const pick = () => store.get().sheet.fields.find(x => x.name === 'allow');
  const inOrder = values => pick().options.map(o => o.value).filter(v => values.includes(v));
  const before = pick().value;
  assert.ok(before.includes('ex'), 'the asked venue ticked');
  const box = (value, checked) => f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', name: 'allow', value, checked, dataset: { action: 'sheetField' } } });
  box('paper', true);
  assert.deepEqual(pick().value, inOrder([...before, 'paper']), "ticked, in the pick's own order");
  assert.equal(pick().value[0], 'paper', 'paper first, as the options are');
  box('ex', false);
  assert.deepEqual(pick().value, inOrder([...before, 'paper'].filter(v => v !== 'ex')), 'unticked');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().sheet, null, 'Escape closes the sheet');
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'declineAsk', ask: 'ask-0002' } });
  assert.deepEqual([store.get().sheet.kind, store.get().sheet.seed], ['declineAsk', { ask: 'ask-0002' }]);
  await until(() => store.get().sheet.status === 'ready', 'the preparation');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'answerAsk', ask: 'ask-0002', decision: 'decline' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetClose' } });
  assert.equal(store.get().sheet, null);
  // Revoke…: the confirm first, the sheet on Yes
  f.click({ tagName: 'BUTTON', dataset: { action: 'askRevoke', name: 'Claude Code', address: '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6' } });
  assert.deepEqual(store.get().confirm, { action: 'revoke', name: 'Claude Code', address: '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6' });
  assert.equal(store.get().sheet, null);
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  assert.deepEqual([store.get().sheet.kind, store.get().sheet.seed.name], ['revoke', 'Claude Code']);
  f.fire('doc', 'keydown', { key: 'Escape' });
  // a page that does not sign: no key opens a sheet
  store.dispatch('ownerStanding', { role: 'pending', kid: door.kid });
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'declineAsk', ask: 'ask-0002' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'grant', ask: 'ask-0001' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'signOut' } });
  assert.equal(store.get().sheet, null);
  store.timers.clear();
});

test("Settings' Let it sign seeds the owners and the waiting key; Sign out, signed, signs this page out and the next page pairs nothing", async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSettings' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'letDevice', kid: 'feedface00000001' } });
  assert.deepEqual(store.get().sheet.seed, { owners: ['device:a5048199a8081854', `device:${door.kid}`], kid: 'feedface00000001' });
  assert.match(f.html(), /aria-label="Settings"[\s\S]*<aside class="drawer sheet"/, 'the sheet over the Settings drawer');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.deepEqual([store.get().sheet, store.get().settingsOpen], [null, true], 'Escape closes the sheet, the drawer under it stays');
  f.click({ tagName: 'BUTTON', dataset: { action: 'signOut' } });
  assert.deepEqual([store.get().sheet.kind, store.get().sheet.seed], ['signOut', { kid: door.kid }]);
  await until(() => store.get().sheet.status === 'ready', 'the preparation');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().owner.role === 'signed-out', 'the page signed out');
  assert.deepEqual(door.sent('/data/account/exchange').at(-1).action.device, `device:${door.kid}`);
  await settle();
  assert.equal(store.get().sheet, null, 'the done sheet closed');
  const pairs = door.sent('/data/account/pair').length;
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await settle();
  assert.equal(door.sent('/data/account/pair').length, pairs, 'signed out: no page pairs it again');
  assert.equal(store.get().owner.role, 'signed-out');
  store.timers.clear();
});

test("the connect sheet opens once where it can connect is read; after the quiet, a pick asks the venue's reach, a key file's venue its check — once for a word typed", async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const timers = new HeldTimers(ms => ms >= 300);
  // the sheet's quiet spells (its own prepare's and the checks'), run together
  const quiet = () => { while (timers.delays().includes(300)) timers.run(300); };
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/venues': fx('venues'), '/data/account/keyfile': fx('keyfile'), '/data/account/connect/reach': { ok: true, reach: [] } } });
  const store = bootOwner(f, h, door, fakeMarkets(), { timers });
  await h.ready();
  await until(signs(store), 'the page to sign');
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'connect' } });
  assert.equal(store.get().sheet, null, 'not before where it can connect is read');
  await until(() => store.get().sheet?.kind === 'connect', 'the connect sheet');
  assert.deepEqual(h.reads, ['/data/account/venues']);
  assert.ok(store.get().sheet.seed.options.some(o => o.connector === 'live:alpaca'), "the page's options");
  const field = (name, value, tagName = 'INPUT') => ({ tagName, type: 'text', name, value, dataset: { action: 'sheetField' } });
  f.fire('root', 'change', { target: field('connector', 'live:alpaca', 'SELECT') });
  await settle();
  assert.deepEqual(h.reads, ['/data/account/venues'], 'nothing before the quiet');
  quiet();
  await settle();
  assert.equal(h.reads.at(-1), '/data/account/connect/reach?connector=live%3Aalpaca');
  // a word typed in two keystrokes: one check, for the word
  f.fire('root', 'input', { target: field('venue', 'alp') });
  f.fire('root', 'input', { target: field('venue', 'alpaca') });
  await settle();
  assert.equal(h.reads.filter(p => p.startsWith('/data/account/keyfile')).length, 0, 'none per keystroke');
  quiet();
  await settle();
  assert.deepEqual(h.reads.filter(p => p.startsWith('/data/account/keyfile')), ['/data/account/keyfile?kind=alpaca&venue=alpaca']);
  const asked = h.reads.length;
  f.fire('root', 'input', { target: field('label', 'My Alpaca') });
  quiet();
  await settle();
  assert.equal(h.reads.length, asked, 'a field neither check reads asks nothing again');
  // a check still waiting when the sheet closes asks nothing
  f.fire('root', 'input', { target: field('venue', 'alpaca-2') });
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetClose' } });
  quiet();
  await settle();
  assert.equal(h.reads.length, asked, 'closed: nothing asked');
  store.timers.clear();
});

test("#/trade shows Trade and reads its kind's picks; Markets' polls stop; leaving Trade stops its own", async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const timers = new HeldTimers();
  const mk = fakeMarkets();
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h, mk, { timers });
  await h.ready();
  assert.equal(mk.live.visible.at(-1), true);
  assert.ok(timers.delays().includes(5_000), "Markets' quotes poll");
  f.win.location.hash = '#/trade';
  await settle();
  assert.equal(store.get().route.screen, 'trade');
  assert.match(f.html(), /<main class="main trade">/);
  assert.equal(mk.live.visible.at(-1), false, "Markets' quotes paused");
  assert.equal(timers.delays().includes(5_000), false, "Markets' polls stopped");
  assert.ok(h.reads.includes('/data/account/explore?tab=crypto&limit=12'), "the kind's picks");
  const picks = timers.delays().filter(ms => ms === 20_000).length;
  assert.equal(picks, 1, "the picks' poll");
  f.win.location.hash = '#/messages/s1';
  await settle();
  assert.equal(timers.delays().filter(ms => ms === 20_000).length, 0, "Trade's poll stopped");
  store.timers.clear();
});

test("Buy or Sell on a market's page opens the ticket on it, once, its line followed after the page let its market go", async () => {
  const f = fakeWindow({ hash: '#/markets/coin:BTC', storage: memoryStorage() });
  const st = fakeStream();
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door, fakeMarkets(), { createAccountStream: st.create });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="openTicket" data-id="coin:BTC" data-side="sell">Sell</);
  let opens = 0;
  store.subscribe((_s, type) => { if (type === 'sheetOpen') opens += 1; });
  f.click({ tagName: 'BUTTON', dataset: { action: 'openTicket', id: 'coin:BTC', side: 'sell' } });
  await settle();
  assert.equal(f.win.location.hash, '#/trade/coin:BTC');
  assert.deepEqual(store.get().trade.ticket, { id: 'coin:BTC', side: 'sell', venue: null, outcome: 0 });
  assert.equal(store.get().sheet.kind, 'order');
  assert.equal(store.get().sheet.fields.side, 'sell');
  assert.equal(opens, 1, 'one ticket, not a buy then a sell');
  assert.match(f.html(), /<h2 class="tk-title">Sell BTC<\/h2>/);
  const venue = store.get().sheet.fields.venue;
  assert.ok(venue);
  assert.deepEqual(st.follows.slice(-2), [[], [`${venue}:${store.get().sheet.seed.ticket.legs.find(l => l.venue === venue).symbol}`]], "the page's market let go, then the ticket's line");
  // the ticket's keys reach the sheet: the amount typed, Buy pressed, the extended-hours box read as ticked
  f.fire('root', 'input', { target: { tagName: 'INPUT', type: 'text', id: 'tk-amount', name: 'amount', value: '25', dataset: { action: 'ticketField' } } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'ticketSide', value: 'buy' } });
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', name: 'extendedHours', value: 'true', checked: true, dataset: { action: 'ticketField' } } });
  assert.deepEqual([store.get().sheet.fields.amount, store.get().sheet.fields.side, store.get().sheet.fields.extendedHours], ['25', 'buy', true]);
  // Where: another able line re-seeds the ticket there (trade.venue), what was typed kept, its line followed
  f.click({ tagName: 'BUTTON', dataset: { action: 'ticketVenue', venue: 'wallet' } });
  assert.deepEqual([store.get().sheet.seed.ticket.venue, store.get().sheet.fields.venue, store.get().sheet.fields.amount], ['wallet', 'wallet', '25']);
  assert.deepEqual(st.follows.at(-1), ['wallet:cbBTC/USDC@Base']);
  // a sheet of Settings › Devices takes the order sheet's place; closed, the ticket's sheet comes back as it was, a tick later
  f.click({ tagName: 'BUTTON', dataset: { action: 'signOut' } });
  assert.equal(store.get().sheet.kind, 'signOut');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().sheet, null, 'not inside the close');
  await settle();
  const back = store.get().sheet;
  assert.equal(back.kind, 'order', 'the ticket has its sheet again');
  assert.deepEqual([back.fields.side, back.fields.venue, back.fields.amount, back.fields.extendedHours], ['buy', 'wallet', '25', true], 'a Buy with its amount stays one');
  assert.equal(store.get().trade.ticket.id, 'coin:BTC');
  assert.match(f.html(), /<h2 class="tk-title">Buy BTC<\/h2>/);
  // an outcome pressed reaches trade.outcome after the sheet took it
  const outcomes = [];
  const outcome = store.trade.outcome;
  store.trade.outcome = i => { outcomes.push([i, store.get().sheet.fields.outcome]); };
  f.click({ tagName: 'BUTTON', dataset: { action: 'ticketOutcome', value: '1' } });
  store.trade.outcome = outcome;
  assert.deepEqual(outcomes, [[1, '1']]);
  // leaving Trade closes the ticket and its sheet
  f.win.location.hash = '#/messages/s1';
  await settle();
  assert.equal(store.get().trade.ticket, null);
  assert.equal(store.get().sheet, null);
  store.timers.clear();
});

test('on a page that does not sign a pick opens the ticket alone; a perpetual opens nothing; the page signing then, the ticket gets its sheet', async () => {
  const f = fakeWindow({ hash: '#/trade/perp:BTC', storage: memoryStorage() });
  const door = ownerDoor({ role: 'pending' });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(() => store.get().owner.role === 'pending', 'the page to wait');
  await settle();
  assert.equal(store.get().trade.ticket, null, '#/trade/<a perpetual> opens no ticket');
  f.click({ tagName: 'BUTTON', dataset: { action: 'pickMarket', id: 'coin:BTC', venue: 'ex' } });
  assert.deepEqual(store.get().trade.ticket, { id: 'coin:BTC', side: 'buy', venue: 'ex', outcome: 0 });
  assert.equal(store.get().sheet, null, 'no sheet on a page that does not sign');
  assert.match(f.html(), /Waiting to be let in/, "the ticket's panel says why");
  f.click({ tagName: 'BUTTON', dataset: { action: 'pickMarket', id: 'perp:BTC' } });
  assert.equal(store.get().trade.ticket.id, 'coin:BTC', 'a perpetual picked changes nothing');
  // let in: the next page names this device, it signs, and the ticket gets its order sheet at its venue
  door.role = 'owner';
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await until(signs(store), 'the page to sign');
  await settle();
  assert.equal(store.get().sheet?.kind, 'order');
  assert.deepEqual([store.get().sheet.seed.id, store.get().sheet.fields.venue, store.get().sheet.fields.side], ['coin:BTC', 'ex', 'buy']);
  store.timers.clear();
});

test("Trade's search reads after 300 ms of quiet, a blank box at once; one still waiting goes when Trade is left", async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  const timers = new HeldTimers(ms => ms >= 300);
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h, fakeMarkets(), { timers });
  await h.ready();
  const box = value => f.fire('root', 'input', { target: { tagName: 'INPUT', type: 'search', id: 'tq', value, dataset: { action: 'tradeQuery' } } });
  const searches = () => h.reads.filter(p => p.startsWith('/data/account/explore?q='));
  box('so');
  box('sol');
  await settle();
  assert.deepEqual(searches(), [], 'nothing before the quiet');
  assert.equal(timers.delays().filter(ms => ms === 300).length, 1, 'a keystroke restarts the wait');
  timers.run(300);
  await settle();
  assert.deepEqual(searches(), ['/data/account/explore?q=sol&limit=12']);
  assert.equal(store.get().trade.q, 'sol');
  box('');
  assert.equal(store.get().trade.q, '', 'a blank box at once');
  assert.equal(timers.delays().includes(300), false);
  box('eth');
  f.win.location.hash = '#/messages/s1';
  await settle();
  assert.equal(timers.delays().includes(300), false, 'left Trade: the search waiting goes');
  assert.equal(searches().length, 1);
  store.timers.clear();
});

test("a quote frame reaches Trade's host; a hidden tab stops Trade's poll and a visible one starts it again", async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  const timers = new HeldTimers();
  const st = fakeStream();
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h, fakeMarkets(), { timers, createAccountStream: st.create });
  await h.ready();
  const seen = [];
  const onStreamEvent = store.trade.onStreamEvent;
  store.trade.onStreamEvent = ev => { seen.push(ev.type); onStreamEvent(ev); };
  st.event('quote', { venue: 'ex', symbol: 'BTC/USDT', last: 63000.5, live: true }, 'r.1');
  st.event('order', { id: 'ord-1' }, 'r.2');
  assert.deepEqual(seen, ['quote'], 'a quote, not an order event');
  const polls = () => timers.delays().filter(ms => ms === 20_000).length;
  assert.equal(polls(), 1);
  f.doc.hidden = true;
  f.fire('doc', 'visibilitychange');
  assert.equal(polls(), 0, 'hidden: no poll');
  f.doc.hidden = false;
  f.fire('doc', 'visibilitychange');
  assert.equal(polls(), 1, 'visible: the poll again');
  store.timers.clear();
});

test('a star on a page that signs is the Account\'s own setWatch, signed', async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'coin:ETH' } });
  await until(() => door.sent('/data/account/exchange').length === 1, 'the signed setWatch');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'setWatch', venue: 'ex', symbol: 'ETH/USDT', on: 'true' });
  assert.equal(door.sent('/data/account/exchange')[0].action.type, 'setWatch');
  await settle();
  assert.ok(h.reads.includes('/data/account?fresh=1'), 'the page read again past the cache');
  // the page's own watch list names BTC: its star, drawn on, comes off the Account's list
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'coin:BTC' } });
  await until(() => door.sent('/data/account/exchange').length === 2, 'the second setWatch');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'setWatch', venue: 'ex', symbol: 'BTC/USDT', on: '' }, 'off, as the Account takes it');
  store.timers.clear();
});

test("Cancel in Under way is the Account's liveCancel, signed, and its answer said; a fill frame is said", async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  const st = fakeStream();
  const door = ownerDoor({ exchange: action => ({ ok: true, kind: 'order', order: { id: action.order, status: 'canceled' } }) });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door, fakeMarkets(), { createAccountStream: st.create });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="cancelOrder" data-venue="ex" data-order="ord-0010">Cancel</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'cancelOrder', venue: 'ex', order: 'ord-0010' } });
  await until(() => store.get().trade.said !== null, 'the answer said');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'liveCancel', venue: 'ex', order: 'ord-0010' });
  assert.equal(door.sent('/data/account/exchange')[0].action.type, 'liveCancel');
  assert.equal(store.get().trade.said, 'ord-0010 · canceled');
  st.event('fill', { side: 'buy', qty: 0.04, symbol: 'ETH/USDT', price: 3120.5, venueName: 'Stand-in Exchange' }, 'r.9');
  assert.equal(store.get().trade.said, 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange');
  assert.match(f.html(), /<p class="tk-said" role="status">Bought 0\.04 ETH @ 3,120\.50 · Stand-in Exchange<\/p>/);
  store.timers.clear();
});
