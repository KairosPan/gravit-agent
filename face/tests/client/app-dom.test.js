// boot() against a fake window and a fake host: what the person sees after the list lands, opening, sending, answering.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot as bootApp, Timers } from '../../client/js/app.js';
import { rowsOf, pairsOf } from '../../client/js/host/market-view.js';
import { kidOf } from '../../client/js/wire/owner-key.js';
import { fakeWindow } from './helpers/fake-dom.js';
import { valueEditor } from './helpers/value-editor.js';
import { modulesListing } from './helpers/inventory.js';
import { VIEW_1027 } from './helpers/lunhui-view.js';
import { fakeProvider, ADDRESS as WALLET_ADDRESS, hashOf } from './helpers/fake-wallet.js';

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
    if (endpoint === 'workspace/pinSession') return { pinnedSessionIds: [args.request.sessionId] };
    if (endpoint === 'workspace/unpinSession') return { pinnedSessionIds: [] };
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
  // an overview's body by workspace id, for a test that reads a channel's runs
  const overviews = {};
  const postJson = async (path, body) => {
    posted.push([path, body]);
    // the face's two session routes, as the host would apply them to the next list
    if (path === '/data/sessions/delete') { const i = rows.findIndex(r => r.sessionId === body.sessionId); if (i >= 0) rows.splice(i, 1); }
    if (path === '/data/sessions/archive') meta.archived = body.archived ? [...meta.archived, body.sessionId] : meta.archived.filter(id => id !== body.sessionId);
    if (path === '/data/channels') { const dir = `/r/strategies/${body.name}`; channelRows.push({ workspaceId: `w-${body.name}`, name: body.name, title: body.name, dir, isRoot: false, sessionIds: [] }); return { ok: true, name: body.name, dir, isRoot: false }; }
    if (path === '/data/channels/overview') return { ok: true, channel: channelRows.find(c => c.workspaceId === body.workspaceId), status: {}, body: overviews[body.workspaceId] ?? {}, agents: [], bots: ['buffett'], allBots: [{ id: 'gravit', name: 'Gravit' }, { id: 'kairos', name: 'Kairos' }, { id: 'buffett', name: 'Buffett' }, { id: 'drill-bear', name: 'Bear' }] };
    if (path === '/data/channels/bots') return { ok: true, bots: body.bots };
    if (path === '/data/bots/settings') { const b = inventory['/data/bots.json'].bots[0]; inventory['/data/bots.json'] = { ok: true, bots: [{ ...b, name: body.name, description: body.description, soul: body.soul, model: body.model ?? undefined, revision: 'r2' }] }; return { ok: true }; }
    if (path === '/data/bots') { inventory['/data/bots.json'] = { ok: true, bots: [...inventory['/data/bots.json'].bots, { id: body.id ?? 'macro', name: body.name, description: '', homeCwd: '/r/bots/macro/home', soul: '', revision: 'm1', isDefault: false, listed: true, skills: [], setupIssues: [] }] }; return { ok: true, bot: { id: body.id ?? 'macro', name: body.name, listed: true } }; }
    if (path === '/data/agents/connect') { const c = inventory['/data/agents.json'].candidates.find(a => a.bin === body.bin); inventory['/data/agents.json'] = { ...inventory['/data/agents.json'], local: [{ ...c, found: true, auth: { state: 'ok' } }], candidates: [] }; return { ok: true, agent: c }; }
    return { ok: true, addressed: [] };
  };
  return { openMux: o => { opts = o; return mux; }, call, getJson, postJson, markdown: null, calls, posted, answered, streams, rows, reads, inventory, overviews, ready: async () => { opts.onReady({}); await settle(); }, opts: () => opts };
}
const started = (f, h) => boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown });
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
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, getJson, markdown: null });
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

// Markets through host: every market read is the Account's, through the host's getJson — there is no wire of the face's to fake
// (a test's own fakes, `more`, beside); the browser's storage a memory
const fakeMarkets = () => ({});
const memoryStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const bootMarkets = (f, h, _mk, more = {}) => boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, ...more });

// the Account's search finds the A shares too: a hit is a cn row, starred on the face's cn list
test("typing in the search box searches; a star watches and writes the face's key; a row opens its page", async () => {
  const storage = memoryStorage();
  const f = fakeWindow({ hash: '#/markets', storage });
  const mq = f.withId('mq', { tagName: 'INPUT', type: 'search', dataset: { action: 'mkQuery' } });
  const h = host();
  const reads = [];
  const getJson = async path => { reads.push(path); return path.startsWith('/data/account/explore?q=600&') ? fx('explore-search-china') : h.getJson(path); };
  // the search waits for a quiet moment in the box: that wait is held here, and run
  const timers = new HeldTimers(ms => ms === 300);
  const store = bootMarkets(f, { ...h, getJson }, null, { timers });
  await h.ready();
  assert.match(f.html(), /<main class="main mkts">/);
  // what the fake host answers to the Account's explore is not an explore answer: nothing to list, and the screen says so
  assert.match(f.html(), /<p class="mk-empty">Markets unavailable<\/p>/);
  mq.value = '600';
  f.fire('root', 'input', { target: mq });
  assert.equal(store.get().markets.q, '600');
  assert.match(f.html(), /Searching…/);
  assert.equal(reads.some(p => p.startsWith('/data/account/explore?q=')), false, 'nothing searched before the wait');
  timers.run(300);
  await settle();
  assert.deepEqual(reads.filter(p => p.startsWith('/data/account/explore?q=')), ['/data/account/explore?q=600&limit=200'], "one read, the Account's");
  assert.match(f.html(), /<tr data-id="cn:600519">/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'cn:600519' } });
  // an A share is an Account key: its star is kept in this browser's Account store (the page does not sign), never the cn list
  assert.deepEqual(JSON.parse(storage.getItem('gravit.account.watch.v1')).items, ['cn:600519']);
  assert.equal(storage.getItem('gravit.market.watchlist.v1'), null, 'the cn list is not written');
  assert.match(f.html(), /data-id="cn:600519" aria-pressed="true" aria-label="Stop watching 贵州茅台"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleWatch', id: 'cn:600519' } });
  assert.deepEqual(JSON.parse(storage.getItem('gravit.account.watch.v1')).items, [], 'a second press stops watching');
  f.click({ tagName: 'BUTTON', dataset: { action: 'mkClear' } });
  assert.equal(store.get().markets.q, '');
  assert.equal(store.get().markets.results.data, null, 'Clear lets the search go');
  assert.ok(reads.every(p => !/^\/data\/(quotes|symbols|cn)\b/.test(p)), "nothing reads the face's own wire");
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
  const timers = new HeldTimers(ms => ms === 5_000 || ms === 20_000);
  const store = bootMarkets(f, h, null, { timers });
  await h.ready();
  const polling = () => timers.delays().includes(5_000);
  assert.equal(polling(), true, 'the quotes poll, the A shares\' with it');
  assert.equal(store.get().route.screen, 'markets', 'the list landing does not pull the page to Messages');
  f.win.location.hash = '#/messages/s1';
  await settle();
  assert.equal(polling(), false);
  f.win.location.hash = '#/markets';
  await settle();
  assert.equal(polling(), true);
  f.doc.hidden = true;
  f.fire('doc', 'visibilitychange');
  assert.equal(polling(), false);
  f.doc.hidden = false;
  f.fire('doc', 'visibilitychange');
  assert.equal(polling(), true);
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

// the face's daily bars are read by no screen: Markets on screen reads the Account's explore instead; an A share's page, reached
// cold, is drawn at once and reads its history at the Account's china venue
test('a market page reads no /data/bars, whatever its id; Markets on screen reads the Account', async () => {
  const f = fakeWindow({ hash: '#/markets/cn:600519', storage: memoryStorage() });
  const h = host();
  const reads = [];
  const getJson = async path => { reads.push(path); return h.getJson(path); };
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, getJson, postJson: h.postJson, markdown: h.markdown });
  await h.ready();
  assert.match(f.html(), /<main class="main mkts mk-page">/);
  assert.match(f.html(), /A-share · 600519 · SH/, 'the A-share page, cold');
  assert.ok(reads.includes('/data/account/explore?limit=200'), "Markets on screen reads the Account's explore");
  assert.ok(reads.includes('/data/account/candles?venue=china&symbol=600519&range=1D'), 'its history at venue china');
  assert.equal(reads.some(p => p.startsWith('/data/account/holdings') || p.startsWith('/data/account/statement')), false, 'nothing held or stated read for an A share');
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
const ASSET_SHEETS = { 'crypto:BTC': 'asset-btc', 'crypto:SOL': 'asset-sol', 'equity:NVDA': 'asset-nvda', 'event:SI-FEDCUT-DEC:YES': 'asset-event' };
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
    // a market page's four reads (plan 4a Task 4): the asset sheet the stand-in keeps for the key, else an empty one; its book (the
    // best bid and ask alone), its trades (none published), no funding
    case '/data/account/asset': return ASSET_SHEETS[q.get('key')] ? fx(ASSET_SHEETS[q.get('key')]) : { ok: true, key: q.get('key'), positions: [], orders: [], lines: [], cost: [], missing: [] };
    case '/data/account/book': return { ...fx('book'), venue: q.get('venue'), symbol: q.get('symbol') };
    case '/data/account/trades': return { ...fx('trades'), venue: q.get('venue'), symbol: q.get('symbol') };
    case '/data/account/funding': return { ok: true, lines: [], missing: [] };
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
const bootAccount = (f, h, _mk = fakeMarkets(), more = {}) => boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, ...more });

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
  for (const read of ['/data/account/holdings?cost=1', '/data/account/holdings?cost=1&paper=1', '/data/account/statement', '/data/account/candles?venue=ex&symbol=BTC%2FUSDT&range=1D', '/data/account/compare?base=BTC&side=buy',
    '/data/account/asset?key=crypto%3ABTC', '/data/account/book?venue=ex&symbol=BTC%2FUSDT&depth=10', '/data/account/trades?venue=ex&symbol=BTC%2FUSDT&limit=20']) {
    assert.ok(h.reads.includes(read), read);
  }
  // what is held of it (the asset sheet) and the statement's lines about it, from their own reads; its book and its trades
  assert.match(f.html(), /0\.124 BTC · \$7,747\.40/);
  assert.match(f.html(), /Stand-in Exchange · Top of book only/);
  assert.match(f.html(), /Stand-in Exchange publishes no trades the account can read/);
  assert.equal(h.reads.filter(p => p.startsWith('/data/account/funding')).length, 0, 'a coin has no funding');
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

test("an A share's page, reached by a link, reads its 1D history from the face's own route; a range reads that range", async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h, fakeMarkets());
  await h.ready();
  h.reads.length = 0;
  f.win.location.hash = '#/markets/cn:600519';
  await settle();
  assert.ok(h.reads.includes('/data/account/candles?venue=china&symbol=600519&range=1D'), JSON.stringify(h.reads));
  assert.equal(h.reads.some(r => r.startsWith('/data/account/holdings')), false, 'nothing held of an A share is read from the Account');
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'setRange', id: 'cn:600519', value: '1M' } });
  await settle();
  assert.ok(h.reads.includes('/data/account/candles?venue=china&symbol=600519&range=1M'), JSON.stringify(h.reads));
  store.timers.clear();
});

test("a non-canonical A-share link still reads its history at the canonical id (minor #7)", async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h, fakeMarkets());
  await h.ready();
  h.reads.length = 0;
  f.win.location.hash = '#/markets/cn:sh600519';
  await settle();
  assert.ok(h.reads.includes('/data/account/candles?venue=china&symbol=600519&range=1D'), JSON.stringify(h.reads));
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
  const timers = new HeldTimers(ms => ms >= 5_000 || ms === 300);
  const store = bootAccount(f, h, null, { timers });
  await h.ready();
  const searched = () => h.reads.filter(p => p.startsWith('/data/account/explore?q='));
  mq.value = 'BT';
  f.fire('root', 'input', { target: mq });
  assert.equal(store.get().markets.q, 'BT', 'the query moves at once');
  assert.equal(store.get().markets.tab, 'results');
  assert.deepEqual(searched(), [], 'nothing searched yet');
  const first = timers.ids().filter(id => timers.held.get(id).ms === 300);
  mq.value = 'BTC';
  f.fire('root', 'input', { target: mq });
  const second = timers.ids().filter(id => timers.held.get(id).ms === 300);
  assert.equal(second.length, 1, 'one wait at a time');
  assert.notDeepEqual(second, first, 'a keystroke restarts it');
  timers.run(300);
  await settle();
  assert.deepEqual(searched(), ['/data/account/explore?q=BTC&limit=200'], "the Account's search, once, for what was typed last — the A shares' with it");
  // a wait cut short by Clear: the search goes blank at once, and the wait never searches
  mq.value = 'ETH';
  f.fire('root', 'input', { target: mq });
  f.click({ tagName: 'BUTTON', dataset: { action: 'mkClear' } });
  assert.equal(store.get().markets.q, '');
  assert.equal(mq.value, '');
  assert.equal(timers.delays().includes(300), false, 'the wait is cancelled');
  assert.equal(searched().length, 1, 'ETH never searched');
  // a box emptied by hand searches blank at once too
  mq.value = 'SOL';
  f.fire('root', 'input', { target: mq });
  mq.value = '';
  f.fire('root', 'input', { target: mq });
  assert.equal(timers.delays().includes(300), false);
  assert.equal(searched().length, 1);
  store.timers.clear();
});

// the final review: the page re-renders on every quote tick, so a click whose press and release straddle a render
// never fires; renders wait while a press is down
test('a press holds renders until it ends, so a streaming quote cannot swallow the click', async () => {
  const storage = memoryStorage();
  storage.setItem('gravit.market.watchlist.v1', JSON.stringify({ version: 1, items: [{ id: 'crypto:BTC/USD', market: 'crypto', symbol: 'BTC/USD', name: 'Bitcoin', exchange: '', currency: 'USD' }] }));
  const f = fakeWindow({ hash: '#/markets', storage });
  const h = host();
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, pointerHoldMs: 20 });
  await h.ready();
  // a quote landing, as the quotes poll lands one: a store change, which renders
  const tick = price => store.dispatch('accountQuotesLoaded', { quotes: [{ venue: 'ex', symbol: 'BTC/USDT', market: { price, quoteAt: '2026-10-20T14:00:00Z' } }] });
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
  assert.match(html, /<div class="shelf-title">Research <span class="dim">Lunhui · 6 modules<\/span><\/div>/, "the subtitle sits in the title, not beside See all");
  for (const chip of ['WEAK · STABLE', 'IGNITION · POSITIVE · NONE', 'not evaluable · boards', 'lunhui-s01-repair · no candidate', 'lunhui-s01-repair · WAIT', 'lunhui-s01-repair · 5 items']) assert.ok(html.includes(`>${chip}</span>`), chip);
  assert.match(html, /href="#\/module\/theme"/);
  const runs = html.match(/<button[^>]*data-action="runModule"[^>]*>/g) ?? [];
  assert.equal(runs.length, 6);
  assert.ok(runs.every(b => !/\bdisabled\b/.test(b) && !/\btitle=/.test(b)), 'Run is on while the rows are mounted');
  assert.doesNotMatch(html, /Lunhui rows not mounted/);
  h.inventory['/data/modules.json'] = { ...modulesListing(), mounted: false };
  f.click({ tagName: 'BUTTON', dataset: { action: 'shelfRetry', shelf: 'modules' } });
  await settle();
  assert.match(f.html(), /Lunhui rows not mounted/);
  assert.equal(f.html().match(/class="pcard research in-grid dim"/g)?.length, 6);
  assert.ok(f.html().includes('>WEAK · STABLE</span>'), 'a dim card still shows its last headline');
  const dimRuns = f.html().match(/<button[^>]*data-action="runModule"[^>]*>/g) ?? [];
  assert.ok(dimRuns.length === 6 && dimRuns.every(b => /\bdisabled\b/.test(b)), 'rows not mounted: Run is off');
  store.timers.clear();
});

test('the module page: head, the three boxes, the runs table, the legend, the latest artifact after the overview answers; an unknown name', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  h.overviews['ws-cn-market'] = { latestRun: { run: '20261028T020953Z-f3b89ce6', artifacts: { sentiment: { headline: {}, json: { module: 'sentiment', state: 'IGNITION' } } } } };
  const store = started(f, h);
  await h.ready();
  f.win.location.hash = '#/module/sentiment';
  await settle();
  assert.deepEqual(store.get().route, { screen: 'module', id: 'sentiment' });
  const html = f.html();
  assert.match(html, /<main class="main disc plugin-page"><a id="page-back" class="back-link page-back" href="#\/discover">‹ Discover<\/a>/);
  assert.match(html, /plug-name">Sentiment</);
  assert.ok(html.includes('CN market analyst · deepseek-flash · cn-market'));
  assert.ok(html.includes('>MODULE</span>'));
  assert.ok(html.includes('>IGNITION · POSITIVE · NONE</span>'));
  for (const box of ['Reads', 'Writes', 'Runs on']) assert.ok(html.includes(`dsec-label">${box}</div>`), box);
  assert.ok(html.includes('>sentiment.json</span>'));
  assert.ok(html.includes('>limit-up and index</span>'));
  assert.ok(html.includes('strategies/cn-market/analysis/&lt;run&gt;/'));
  assert.ok(html.includes('>10 calls per run · one artifact per run</span>'));
  assert.match(html, /<table class="mod-runs">[\s\S]*<td class="mono">20261028T020953Z-f3b89ce6<\/td>/);
  assert.ok(html.includes('The text&#39;s stages beside the seven labels'));
  assert.ok(html.includes('P0161'));
  const run = html.match(/<button[^>]*data-action="runModule"[^>]*>/g) ?? [];
  assert.equal(run.length, 1);
  assert.doesNotMatch(run[0], /\bdisabled\b/);
  assert.match(run[0], /data-module="sentiment"/);
  assert.deepEqual(h.posted.filter(p => p[0] === '/data/channels/overview'), [['/data/channels/overview', { workspaceId: 'ws-cn-market' }]]);
  assert.match(html, /<details class="acct-shown"><summary>20261028T020953Z-f3b89ce6 · cn-market<\/summary><pre class="disc-text">\{&quot;module&quot;:&quot;sentiment&quot;,&quot;state&quot;:&quot;IGNITION&quot;\}<\/pre><\/details>/);
  assert.match(html, /class="nav-item current" aria-current="page" href="#\/discover"/);
  store.dispatch('toggleRail');
  assert.equal(h.posted.filter(p => p[0] === '/data/channels/overview').length, 1, 'a render reads nothing');
  // Run opens the module's sheet over its page, and posts nothing
  f.click({ tagName: 'BUTTON', dataset: { action: 'runModule', module: 'sentiment' } });
  await settle();
  assert.match(f.html(), /role="dialog" aria-label="Run Sentiment"/);
  assert.equal(h.posted.filter(p => p[0] === '/data/channels/overview').length, 1, 'opening the sheet reads no overview');
  f.fire('doc', 'keydown', { key: 'Escape' });
  // an unknown name: Not found, with the way back
  f.win.location.hash = '#/module/foo';
  await settle();
  assert.match(f.html(), /<main class="main disc plugin-page"><a id="page-back" class="back-link page-back" href="#\/discover">‹ Discover<\/a><div class="disc-none dim">Not found<\/div>/);
  assert.match(f.html(), /class="nav-item current" aria-current="page" href="#\/discover"/);
  assert.equal(h.posted.filter(p => p[0] === '/data/channels/overview').length, 1, 'an unknown name reads nothing');
  store.timers.clear();
});

test('the module page opened from the Research shelf goes back to it; a module with no overview latestRun says where older runs are', async () => {
  const f = fakeWindow({ hash: '#/discover/research' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  await settle();
  f.win.location.hash = '#/module/theme';
  await settle();
  const html = f.html();
  assert.match(html, /href="#\/discover\/research">‹ Discover</);
  assert.ok(html.includes('>not evaluable · boards</span>'));
  assert.match(html, /open the channel page to read older runs/);
  assert.doesNotMatch(html, /mod-legend/, 'Theme has no legend');
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

test('an opened disclosure stays open across the next render', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.withSelector('details[id][open]', { tagName: 'DETAILS', id: 'trace-s1-e9', open: true });
  const again = f.withId('trace-s1-e9', { tagName: 'DETAILS', open: false });
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
  assert.doesNotMatch(f.html(), /tool-mc1|class="tool/, "the member's tool call is not drawn");
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
    if (path === '/data/account/guard') return { status: 200, body: { ok: true, mode: 'guard' } };
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

// plan 4b Task 5: the limit sheet's kind of limit, End limit… by its kind, Open an agent wallet…, Top up… and Take back…
test('Agents: a limit changes kind on the seg, End limit… ends its own kind, an agent wallet opens on the keys let in, Top up… and Take back… open the move sheet', async () => {
  const f = fakeWindow({ hash: '#/account/agents', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  const CC = '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6';
  const field = name => store.get().sheet.fields.find(x => x.name === name);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'limit', address: CC, name: 'Claude Code' } });
  assert.deepEqual([store.get().sheet.kind, field('scope').value], ['limit', 'trade']);
  f.click({ tagName: 'BUTTON', name: 'scope', dataset: { action: 'sheetField', value: 'payees' } });
  assert.deepEqual([field('scope').value, field('payees').value, field('allow')], ['payees', 'api.example.com', undefined], 'the pick swapped for the hosts');
  f.fire('doc', 'keydown', { key: 'Escape' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'endLimit', address: CC, name: 'Claude Code', scope: 'venues', allow: 'ex,agent-claude-code' } });
  await until(() => store.get().sheet.status === 'ready', 'the preparation');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { ...door.sent('/data/account/prepare').at(-1).draft, type: 'approveSpend', agent: CC, scope: 'venues', allow: 'ex,agent-claude-code', budget: '0' });
  f.fire('doc', 'keydown', { key: 'Escape' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'subWallet' } });
  assert.deepEqual([store.get().sheet.kind, field('agent').value], ['subWallet', CC]);
  f.fire('doc', 'keydown', { key: 'Escape' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'move', from: 'ex', to: 'agent-claude-code' } });
  assert.deepEqual([store.get().sheet.kind, field('from').value, field('to')?.value], ['move', 'ex', 'agent-claude-code']);
  f.fire('doc', 'keydown', { key: 'Escape' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'move', from: 'agent-claude-code' } });
  assert.deepEqual([store.get().sheet.kind, field('from').value], ['move', 'agent-claude-code']);
  f.fire('doc', 'keydown', { key: 'Escape' });
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
  assert.deepEqual([store.get().sheet.kind, store.get().sheet.seed], ['signOut', { kid: door.kid, mode: 'guard', others: 1 }]);
  assert.match(f.html(), /Your 1 other device keeps signing\./);
  assert.doesNotMatch(f.html(), /name="guard"/, 'no Guard box in Guard');
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

// plan 4b Task 6: Cards grants every kind of ask
test('Grant on a session ask signs setPolicy session', async () => {
  const f = fakeWindow({ hash: '#/account/cards', storage: memoryStorage() });
  const door = ownerDoor();
  const ask = { id: 'ask-0007', agent: '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6', agentName: 'Claude Code', kind: 'session', venue: '', usd: '', text: 'My session ran out', at: '', expiresAt: '' };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => ({ ...door.page(), asks: [ask] }) } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="grant" data-ask="ask-0007">Grant<\/button>/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'grant', ask: 'ask-0007' } });
  assert.equal(store.get().sheet.kind, 'session');
  await until(() => store.get().sheet.status === 'ready', 'the preparation');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'setPolicy', change: 'session', value: '30d' });
  assert.match(f.html(), /<p class="sheet-hint">Claude Code asked: “My session ran out”<\/p>/, "the ask under the sheet's title");
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => door.sent('/data/account/exchange').length === 1, 'the signature');
  assert.deepEqual(door.sent('/data/account/exchange')[0].action, { ...door.sent('/data/account/exchange')[0].action, type: 'setPolicy', change: 'session', value: '30d' });
  store.timers.clear();
});

test('a venue ask not on the page: Grant reads where the account can connect, then opens the connect sheet on its option', async () => {
  const f = fakeWindow({ hash: '#/account/cards', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => ({ ...door.page(), asks: [{ ...fx('account').asks[1], venue: 'okx' }] }), '/data/account/venues': fx('venues'), '/data/account/keyfile': fx('keyfile'), '/data/account/connect/reach': { ok: true, reach: [] } } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="grant" data-ask="ask-0002">Grant<\/button>/, 'Grant drawn before the read');
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'grant', ask: 'ask-0002' } });
  assert.equal(store.get().sheet, null, 'not before the read');
  await until(() => store.get().sheet?.kind === 'connect', 'the connect sheet');
  assert.equal(h.reads[0], '/data/account/venues');
  const field = name => store.get().sheet.fields.find(x => x.name === name)?.value;
  assert.deepEqual([field('connector'), field('exchange')], ['live:exchange', 'okx']);
  store.timers.clear();
});

test('a venue Grant whose read of where the account can connect fails says so under the asks', async () => {
  const f = fakeWindow({ hash: '#/account/cards', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => ({ ...door.page(), asks: [{ ...fx('account').asks[1], venue: 'okx' }] }), '/data/account/venues': () => { throw new Error('offline'); } } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'grant', ask: 'ask-0002' } });
  await until(() => typeof store.get().account.grantSaid === 'string', 'the words');
  assert.equal(store.get().sheet, null, 'no sheet');
  assert.match(store.get().account.grantSaid, /^Not opened: where this account can connect was not read/);
  assert.match(f.html(), /<p class="acct-note">Not opened: where this account can connect was not read/);
  store.timers.clear();
});

// Review Focus: Settings › Devices' sign-out of the last device in Beast, Guard first
test('the last device signs out in Beast: Guard refused, nothing signed and the device still signs; Guard taken and the sign-out refused, Guard stays and the words say so', async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  let mode = 'open';
  let guardAnswer = { status: 409, body: { ok: false, refusal: { ok: false, code: 'E_ACCOUNT_READ_ONLY', layer: 'account', message: 'the account is read-only' } } };
  const door = ownerDoor({ exchange: action => (action.type === 'signOut' ? { ok: false, refusal: { ok: false, code: 'E_ACCOUNT_LAST_OWNER', layer: 'account', message: 'the last owner cannot leave yet' } } : { ok: true, kind: 'result', result: { ok: true } }) });
  const post = door.post;
  door.post = async (path, body) => {
    if (path !== '/data/account/guard') return post(path, body);
    door.posts.push([path, body]);
    if (guardAnswer.status === 200) mode = 'guard';
    return guardAnswer;
  };
  // this page the only owner (the seed key gone), in Beast until a Guard is taken
  const page = () => { const p = door.page(); return { ...p, mode, signers: { ...p.signers, owners: p.signers.owners.filter(o => o.id === `device:${door.kid}`) } }; };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await until(() => store.get().account.data?.signers?.owners?.length === 1, 'the page naming this device alone');
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSettings' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'signOut' } });
  assert.deepEqual(store.get().sheet.seed, { kid: door.kid, mode: 'open', others: 0 });
  await until(() => store.get().sheet.status === 'ready', 'the preparation');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'signOut', device: `device:${door.kid}` });
  const html = f.html();
  assert.match(html, /<input type="checkbox" name="guard" value="true" checked data-action="sheetField">Switch to Guard first: whatever an agent asks for waits for a signature<\/label>/);
  assert.match(html, /No browser will sign for the account until one pairs again, with a new pairing code: the terminal the Account runs in shows it, or npm run account:service -- code when it runs in the background\./);
  // Guard refused: nothing signed, the words, the device still signs
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().sheet?.status === 'refused', 'the refusal');
  assert.equal(door.sent('/data/account/guard').length, 1);
  assert.equal(door.sent('/data/account/exchange').length, 0, 'nothing signed');
  assert.equal(store.get().sheet.message, 'Not signed out: Guard was refused — the account is read-only');
  assert.match(f.html(), /Not signed out: Guard was refused — the account is read-only/);
  assert.equal(store.get().owner.role, 'signs', 'the device still signs');
  // Guard taken, the sign-out refused: Guard stays, the words say so, the device still signs
  guardAnswer = { status: 200, body: { ok: true, mode: 'guard' } };
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetAgain' } });
  await until(() => store.get().sheet.status === 'ready', 'prepared again');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().sheet?.status === 'refused', 'the sign-out refused');
  assert.equal(door.sent('/data/account/guard').length, 2);
  assert.equal(door.sent('/data/account/exchange').length, 1, 'signed once Guard was taken');
  assert.equal(store.get().sheet.message, 'Not signed out: the last owner cannot leave yet. Guard is on.');
  assert.equal(store.get().owner.role, 'signs');
  await until(() => store.get().account.data.mode === 'guard', 'Guard on the page');
  assert.equal(mode, 'guard', 'Guard stays');
  store.timers.clear();
});

test('the last device signs out in Beast with Guard taken: signed out, and the done line ends Guard is on.', async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  let mode = 'open';
  const door = ownerDoor();
  const post = door.post;
  door.post = async (path, body) => { if (path === '/data/account/guard') { door.posts.push([path, body]); mode = 'guard'; return { status: 200, body: { ok: true, mode: 'guard' } }; } return post(path, body); };
  const page = () => { const p = door.page(); return { ...p, mode, signers: { ...p.signers, owners: p.signers.owners.filter(o => o.id === `device:${door.kid}`) } }; };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await until(() => store.get().account.data?.signers?.owners?.length === 1, 'the page naming this device alone');
  const said = [];
  store.subscribe((st, type) => { if (type === 'sheetDone') said.push(st.sheet.said); });
  f.click({ tagName: 'BUTTON', dataset: { action: 'signOut' } });
  await until(() => store.get().sheet.status === 'ready', 'the preparation');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().owner.role === 'signed-out', 'the page signed out');
  const [g] = door.posts.map(([p]) => p).filter(p => p === '/data/account/guard' || p === '/data/account/exchange');
  assert.equal(g, '/data/account/guard', 'Guard before the signature');
  assert.match(said[0], / Guard is on\.$/);
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

// ── Venues: every connector kind, and Close to agents (plan 4b Task 4) ──

// the owner door with the browser wallet's two routes and Close to agents answered as the Account answers them; what was posted kept
function walletDoor({ role = 'owner', prove = () => ({ status: 200, body: { ok: true, address: WALLET_ADDRESS } }) } = {}) {
  const door = ownerDoor({ role });
  const inner = door.post;
  door.post = async (path, body) => {
    if (path === '/data/account/wallet/challenge') { door.posts.push([path, body]); return { status: 200, body: { ok: true, message: 'localhost wants you to sign in with your Ethereum account' } }; }
    if (path === '/data/account/wallet/prove') { door.posts.push([path, body]); return prove(body); }
    if (path === '/data/account/revoke') { door.posts.push([path, body]); door.revoked.push(body.account); return { status: 200, body: { ok: true } }; }
    return inner(path, body);
  };
  door.revoked = [];
  const page = door.page;
  door.page = () => { const p = page(); return { ...p, dial: { ...p.dial, revoked: [...door.revoked] } }; };
  return door;
}
const pickConnector = (f, connector) => f.fire('root', 'change', { target: { tagName: 'SELECT', type: 'select-one', name: 'connector', value: connector, dataset: { action: 'sheetField' } } });
async function openConnect(f, store) {
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'connect' } });
  await until(() => store.get().sheet?.kind === 'connect', 'the connect sheet');
}

test("the connect sheet's wallet tile proves the fake wallet and fills the address", async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const provider = fakeProvider();
  const door = walletDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/venues': fx('venues'), '/data/account/connect/reach': { ok: true, reach: [] } } });
  const store = bootOwner(f, h, door, fakeMarkets(), { getWallets: async () => [{ id: 'fake', name: 'Fake Wallet', icon: '', provider }] });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await openConnect(f, store);
  pickConnector(f, 'live:wallet');
  await until(() => store.get().account.connectWallet.status === 'found', 'the wallets found');
  const html = f.html();
  assert.match(html, /<button type="button" class="btn-sm" data-action="connectWallet" data-wallet="fake">Use Fake Wallet<\/button>/);
  assert.ok(html.indexOf('Use Fake Wallet') < html.indexOf('name="ref"'), 'the tile above the address it fills');
  assert.doesNotMatch(html, /Connect on the Account page/);
  assert.equal(provider.requests.length, 0, 'nothing asked of the wallet before the press');
  f.click({ tagName: 'BUTTON', dataset: { action: 'connectWallet', wallet: 'fake' } });
  await until(() => store.get().account.connectWallet.status === 'proven', 'the wallet signed');
  assert.deepEqual(provider.methods(), ['eth_requestAccounts', 'eth_chainId', 'personal_sign']);
  assert.deepEqual(door.sent('/data/account/wallet/challenge'), [{ address: WALLET_ADDRESS, wallet: 'Fake Wallet', chainId: 8453 }]);
  assert.equal(door.sent('/data/account/wallet/prove')[0].address, WALLET_ADDRESS);
  const fields = Object.fromEntries(store.get().sheet.fields.map(fl => [fl.name, fl.value]));
  assert.deepEqual([fields.ref, fields.label], [WALLET_ADDRESS, 'Fake Wallet'], 'the address, and the name left blank');
  assert.match(f.html(), /Fake Wallet signed: 0x121212…1212 is yours\./);
  // after the sheet's quiet the form is prepared: the page has a wallet already, so this one is numbered by its address
  await until(() => door.sent('/data/account/prepare').some(b => b.draft.connector === 'live:wallet'), 'the preparation');
  assert.deepEqual(door.sent('/data/account/prepare').find(b => b.draft.connector === 'live:wallet').draft,
    { type: 'connectVenue', venue: 'wallet-121212', connector: 'live:wallet', label: 'Fake Wallet', credentialRef: WALLET_ADDRESS });
  // another address option picked: the proven address is not carried to it, the name is, and the proof is forgotten
  pickConnector(f, 'live:hyperliquid');
  await settle();
  const moved = Object.fromEntries(store.get().sheet.fields.map(fl => [fl.name, fl.value]));
  assert.deepEqual([moved.connector, moved.ref, moved.label], ['live:hyperliquid', '', 'Fake Wallet']);
  assert.equal(store.get().account.connectWallet.status, 'found', 'the wallets found stay, the proof does not');
  assert.equal(store.get().account.connectWallet.address, '');
  assert.doesNotMatch(f.html(), /is yours\./);
  store.timers.clear();
});

test("a wallet prompt still open across a connector change: no second prompt until it settles, and its answer lands only on its option", async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const held = [];
  const provider = fakeProvider({ answers: { personal_sign: () => new Promise(res => held.push(() => res('0x' + 'ee'.repeat(65)))) } });
  const door = walletDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/venues': fx('venues'), '/data/account/connect/reach': { ok: true, reach: [] } } });
  const store = bootOwner(f, h, door, fakeMarkets(), { getWallets: async () => [{ id: 'fake', name: 'Fake Wallet', icon: '', provider }] });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await openConnect(f, store);
  pickConnector(f, 'live:wallet');
  await until(() => store.get().account.connectWallet.status === 'found', 'the wallets found');
  f.click({ tagName: 'BUTTON', dataset: { action: 'connectWallet', wallet: 'fake' } });
  await until(() => held.length === 1, 'the wallet prompt open');
  // away and back while the prompt is open: still asking, the tile off, and a press asks the wallet nothing more
  pickConnector(f, 'live:hyperliquid');
  await settle();
  assert.equal(store.get().account.connectWallet.status, 'asking');
  pickConnector(f, 'live:wallet');
  await settle();
  assert.match(f.html(), /data-action="connectWallet" data-wallet="fake" disabled>Use Fake Wallet</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'connectWallet', wallet: 'fake' } });
  await settle();
  assert.equal(provider.count('personal_sign'), 1, 'one prompt at a time');
  // away again, and the prompt answers there: nothing lands on the other option, and the tiles are free
  pickConnector(f, 'live:hyperliquid');
  await settle();
  held[0]();
  await until(() => store.get().account.connectWallet.status === 'found', 'settled elsewhere');
  const fields = Object.fromEntries(store.get().sheet.fields.map(fl => [fl.name, fl.value]));
  assert.deepEqual([fields.connector, fields.ref], ['live:hyperliquid', ''], 'the address not landed on another option');
  pickConnector(f, 'live:wallet');
  await settle();
  assert.match(f.html(), /data-action="connectWallet" data-wallet="fake">Use Fake Wallet</, 'pressable again');
  store.timers.clear();
});

test("no wallet on the page: the sheet says to type the address; a declined signature says the wallet's words and posts no proof", async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const door = walletDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/venues': fx('venues'), '/data/account/connect/reach': { ok: true, reach: [] } } });
  const store = bootOwner(f, h, door, fakeMarkets(), { getWallets: async () => [] });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await openConnect(f, store);
  pickConnector(f, 'live:wallet');
  await until(() => store.get().account.connectWallet.status === 'none', 'no wallet found');
  assert.match(f.html(), /No browser wallet answered on this page\. Type the address to watch it\./);
  assert.doesNotMatch(f.html(), /data-action="connectWallet"/, 'no tile');
  store.timers.clear();

  // a wallet that declines to sign: its words, and no proof posted
  const f2 = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const declines = fakeProvider({ answers: { personal_sign: () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); } } });
  const door2 = walletDoor();
  const h2 = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door2.page(), '/data/account/venues': fx('venues'), '/data/account/connect/reach': { ok: true, reach: [] } } });
  const store2 = bootOwner(f2, h2, door2, fakeMarkets(), { getWallets: async () => [{ id: 'fake', name: 'Fake Wallet', icon: '', provider: declines }] });
  await h2.ready();
  await until(signs(store2), 'the page to sign');
  await openConnect(f2, store2);
  pickConnector(f2, 'live:wallet');
  await until(() => store2.get().account.connectWallet.status === 'found', 'the wallet found');
  f2.click({ tagName: 'BUTTON', dataset: { action: 'connectWallet', wallet: 'fake' } });
  await until(() => store2.get().account.connectWallet.status === 'refused', 'the refusal');
  // after the venue's own words on where it answers from (the stand-in's wallet verdict), the wallet's
  assert.match(f2.html(), /<p class="sheet-hint">[^<]* · User rejected the request\.<\/p>/);
  assert.deepEqual(door2.sent('/data/account/wallet/prove'), [], 'no proof posted');
  assert.equal(store2.get().sheet.fields.find(fl => fl.name === 'ref').value, '', 'the address left as it was');
  store2.timers.clear();
});

test("Sign in at Robinhood opens a tab inside the press, sends it to the venue's page, and the state signed in is what connects", async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const tabs = [];
  f.win.open = (url, target) => { const t = { opener: {}, location: { href: url }, target, close() {} }; tabs.push(t); return t; };
  const door = walletDoor();
  const inner = door.post;
  door.post = async (path, body) => (path === '/data/account/signin/start'
    ? (door.posts.push([path, body]), { status: 200, body: { ok: true, url: 'https://robinhood.example/oauth?state=st-7', state: 'st-7' } })
    : inner(path, body));
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/venues': fx('venues'), '/data/account/connect/reach': { ok: true, reach: [] }, '/data/account/signin/status': { ok: true, status: 'ready' } } });
  const store = bootOwner(f, h, door, fakeMarkets());
  await h.ready();
  await until(signs(store), 'the page to sign');
  await openConnect(f, store);
  pickConnector(f, 'live:robinhood');
  await settle();
  assert.match(f.html(), /<button type="button" class="btn-sm" data-action="connectSignIn">Sign in at Robinhood<\/button>/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'connectSignIn' } });
  assert.equal(tabs.length, 1, 'the tab opened inside the press');
  assert.deepEqual([tabs[0].location.href, tabs[0].target, tabs[0].opener], ['about:blank', '_blank', null]);
  await until(() => store.get().account.signIn.status === 'ready', 'signed in');
  assert.equal(tabs[0].location.href, 'https://robinhood.example/oauth?state=st-7');
  assert.deepEqual(door.sent('/data/account/signin/start'), [{ connector: 'robinhood' }]);
  assert.ok(h.reads.includes('/data/account/signin/status?state=st-7'));
  assert.match(f.html(), /Signed in\. Connect it\./);
  await until(() => door.sent('/data/account/prepare').some(b => b.draft.connector === 'live:robinhood'), 'the preparation');
  assert.deepEqual(door.sent('/data/account/prepare').find(b => b.draft.connector === 'live:robinhood').draft,
    { type: 'connectVenue', venue: 'robinhood', connector: 'live:robinhood', label: '', credentialRef: 'st-7' });
  store.timers.clear();
});

test('a sign-in the Account refuses says its words once, however many times it is pressed', async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  f.win.open = () => ({ opener: {}, location: { href: '' }, close() {} });
  const door = walletDoor();
  const inner = door.post;
  door.post = async (path, body) => (path === '/data/account/signin/start'
    ? (door.posts.push([path, body]), { status: 502, body: { ok: false, refusal: { code: 'E_VENUE_UNREACHABLE', message: 'Robinhood did not answer' } } })
    : inner(path, body));
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/venues': fx('venues'), '/data/account/connect/reach': { ok: true, reach: [] } } });
  const store = bootOwner(f, h, door, fakeMarkets());
  await h.ready();
  await until(signs(store), 'the page to sign');
  await openConnect(f, store);
  pickConnector(f, 'live:robinhood');
  await settle();
  for (let i = 1; i <= 3; i += 1) {
    f.click({ tagName: 'BUTTON', dataset: { action: 'connectSignIn' } });
    await until(() => door.sent('/data/account/signin/start').length === i && store.get().account.signIn.status === 'failed', `refusal ${i}`);
    await settle();
    assert.equal(f.html().split('Robinhood did not answer').length - 1, 1, `said once after ${i} presses`);
  }
  store.timers.clear();
});

test('Close to agents on a page that does not sign posts the revoke; Reopen… needs a page that signs', async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const door = walletDoor({ role: 'pending' });
  door.revoked.push('broker');
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door, fakeMarkets());
  await h.ready();
  await settle();
  assert.notEqual(store.get().owner.role, 'signs');
  let html = f.html();
  assert.match(html, /<b>Stand-in Broker<\/b> <span class="chip grey">Closed to agents<\/span>/);
  assert.doesNotMatch(html, /data-kind="reopen"/, 'reopening is signed: not on a page that does not sign');
  assert.match(html, /data-action="closeToAgents" data-venue="ex">Close to agents<\/button>/);
  assert.doesNotMatch(html, /data-action="closeToAgents" data-venue="paper-momentum"/, 'a paper venue has neither');
  f.click({ tagName: 'BUTTON', dataset: { action: 'closeToAgents', venue: 'ex' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'closeToAgents', venue: 'ex' } });
  await until(() => store.get().account.closing.ex?.status === 'said', 'the revoke said');
  await settle();
  assert.deepEqual(door.sent('/data/account/revoke'), [{ account: 'ex' }], 'one unsigned POST, pressed twice');
  html = f.html();
  assert.match(html, /Stand-in Exchange is closed to agents: they keep reading it, and place or move nothing there\. Reopening it is signed\./);
  assert.match(html, /<b>Stand-in Exchange<\/b> <span class="chip grey">Closed to agents<\/span>/, 'the page read again draws it closed');
  store.timers.clear();

  // a page that signs: Reopen…, the signed setPolicy restore
  const f2 = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const door2 = walletDoor();
  door2.revoked.push('broker');
  const h2 = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door2.page() } });
  const store2 = bootOwner(f2, h2, door2, fakeMarkets());
  await h2.ready();
  await until(signs(store2), 'the page to sign');
  await settle();
  assert.match(f2.html(), /<button type="button" class="btn-sm" data-action="openSheet" data-kind="reopen" data-venue="broker" data-name="Stand-in Broker">Reopen…<\/button>/);
  f2.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'reopen', venue: 'broker', name: 'Stand-in Broker' } });
  await until(() => store2.get().sheet?.status === 'ready', 'the preparation');
  assert.match(f2.html(), /<h2>Reopen Stand-in Broker to agents<\/h2>/);
  assert.deepEqual(door2.sent('/data/account/prepare').at(-1).draft, { type: 'setPolicy', change: 'restore', value: 'broker' });
  f2.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => door2.sent('/data/account/exchange').length === 1, 'signed');
  assert.deepEqual(door2.sent('/data/account/revoke'), [], 'reopening posts no revoke');
  // what Close to agents said of a venue goes once it is reopened
  const f3 = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const door3 = walletDoor();
  const h3 = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door3.page() } });
  const store3 = bootOwner(f3, h3, door3, fakeMarkets());
  await h3.ready();
  await until(signs(store3), 'the page to sign');
  f3.click({ tagName: 'BUTTON', dataset: { action: 'closeToAgents', venue: 'ex' } });
  await until(() => store3.get().account.closing.ex?.status === 'said', 'closed');
  await settle();
  f3.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'reopen', venue: 'ex', name: 'Stand-in Exchange' } });
  await until(() => store3.get().sheet?.status === 'ready', 'the preparation');
  f3.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => !store3.get().account.closing.ex, 'the line gone');
  store3.timers.clear();
  store2.timers.clear();
});

test("#/trade shows Trade and reads its kind's picks; Markets' polls stop; leaving Trade stops its own", async () => {
  const f = fakeWindow({ hash: '#/markets', storage: memoryStorage() });
  const timers = new HeldTimers();
  const h = accountHost({ rows: [row('s1')] });
  const store = bootAccount(f, h, null, { timers });
  await h.ready();
  assert.ok(timers.delays().includes(5_000), "Markets' quotes poll");
  f.win.location.hash = '#/trade';
  await settle();
  assert.equal(store.get().route.screen, 'trade');
  assert.match(f.html(), /<main class="main trade">/);
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

test("Under way's Send from wallet… sends the waiting order through the fake wallet and reports it", async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  // the operator's wallet, injected as window.ethereum (no EIP-6963 events in the fake window): a fake EIP-1193 provider
  const provider = fakeProvider({ flags: { isMetaMask: true } });
  f.win.ethereum = provider;
  const door = ownerDoor();
  const tx = what => ({ chainId: 8453, chainIdHex: '0x2105', from: WALLET_ADDRESS, to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0', what });
  let reported = null;
  // the page with a DEX order waiting for the wallet (an approval, then its swap), placed once its hash is reported
  const page = () => {
    const p = door.page();
    const base = p.orders.find(o => o.id === 'ord-0009');
    const dex = { ...base, id: 'ord-0031', clientId: 'c0ffee00c0ffee00', venue: 'dex', venueName: 'Uniswap', status: 'pending', ref: undefined, walletTxs: [tx('approve'), tx('swap')], ...(reported ? { ref: reported, status: 'open' } : {}) };
    return { ...p, orders: [dex, ...p.orders] };
  };
  const post = async (path, body) => {
    if (path === '/data/account/live/order-requote') { door.posts.push([path, body]); return { status: 200, body: { ok: true, order: { walletTxs: [tx('approve'), { ...tx('swap'), data: '0xfeed' }] } } }; }
    if (path === '/data/account/live/order-sent') { door.posts.push([path, body]); reported = body.hash; return { status: 200, body: { ok: true } }; }
    return door.post(path, body);
  };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost: post });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  const html = f.html();
  assert.match(html, /Waiting for your wallet · ord-0031/);
  assert.match(html, /<button type="button" class="btn-sm" data-action="sendFromWallet" data-order="ord-0031">Send from wallet…<\/button>/);
  assert.match(html, /data-order="ord-0031">Send from wallet…<\/button><button type="button" class="btn-sm" data-action="cancelOrder" data-venue="dex" data-order="ord-0031">Cancel<\/button>/, 'its Cancel beside it: it takes the order back before the wallet sends it');
  assert.doesNotMatch(html, /data-kind="amend"[^>]*data-order="ord-0031"/, 'no Change… either');
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'sendFromWallet', order: 'ord-0031' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'sendFromWallet', order: 'ord-0031' } });
  await until(() => door.sent('/data/account/live/order-sent').length === 1, 'the report');
  assert.equal(h.reads[0], '/data/account?fresh=1', 'the Account asked again before the wallet');
  assert.equal(provider.count('eth_sendTransaction'), 2, 'its approval and its swap, once each, pressed twice');
  assert.equal(provider.requests.filter(r => r.method === 'eth_sendTransaction').at(-1).params[0].data, '0xfeed', 'the swap built again');
  assert.deepEqual(door.sent('/data/account/live/order-requote'), [{ order: 'ord-0031' }]);
  assert.deepEqual(door.sent('/data/account/live/order-sent'), [{ order: 'ord-0031', hash: hashOf(2) }]);
  await until(() => store.get().trade.said !== null, 'the words said');
  assert.equal(store.get().trade.said, 'MetaMask sent it: 0xaaaaaa…aaa2');
  await settle();
  assert.doesNotMatch(f.html(), /data-action="sendFromWallet"/, 'placed: the page read again, the row an order like any other');
  store.timers.clear();
});

test("a payment's report the Account did not take keeps Report again, which reports the same hash and never sends again", async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  const provider = fakeProvider();
  const tx = { chainId: 8453, chainIdHex: '0x2105', from: WALLET_ADDRESS, to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0' };
  const pay = { id: 'pay-0009', at: '2026-11-01T14:00:00.000Z', kind: 'send', from: 'ex', to: 'ex', status: 'authorized', legs: [{ native: { walletTx: tx } }], live: { network: 'Base' } };
  let taken = false;
  let reports = 0;
  const door = ownerDoor();
  const page = () => ({ ...door.page(), payments: taken ? [] : [pay] });
  const post = async (path, body) => {
    if (path === '/data/account/live/sent') { door.posts.push([path, body]); reports += 1; if (reports === 1) return { status: 0, body: { ok: false, error: 'The Account did not answer' } }; taken = true; return { status: 200, body: { ok: true } }; }
    return door.post(path, body);
  };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost: post, getWallets: async () => [{ id: 'fake', name: 'Fake Wallet', icon: '', provider }] });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /<button type="button" class="btn-sm" data-action="sendFromWallet" data-payment="pay-0009">Send from wallet…<\/button>/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'sendFromWallet', payment: 'pay-0009' } });
  await until(() => store.get().account.wallet[`${pay.id}@${pay.at}`]?.status === 'refused', 'the report refused');
  await settle();
  const key = `${pay.id}@${pay.at}`;
  assert.match(f.html(), new RegExp(`<button type="button" class="btn-sm" data-action="reportAgain" data-key="${key.replace(/\./g, '\\.')}">Report again</button>`));
  assert.match(f.html(), /Your wallet sent 0xaaaaaa…aaa1: Report again reports that same transaction, it does not send another/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'reportAgain', key } });
  await until(() => store.get().account.wallet[key]?.status === 'sent', 'the report taken');
  assert.equal(provider.count('eth_sendTransaction'), 1, 'Report again never asks the wallet to send');
  assert.deepEqual(door.sent('/data/account/live/sent'), [{ payment: 'pay-0009', hash: hashOf(1) }, { payment: 'pay-0009', hash: hashOf(1) }]);
  store.timers.clear();
});

test("an order signed on the ticket that waits for the wallet is sent at once and reported; a cancel's answer starts nothing", async () => {
  const f = fakeWindow({ hash: '#/markets/coin:BTC', storage: memoryStorage() });
  const provider = fakeProvider();
  const tx = { chainId: 8453, chainIdHex: '0x2105', from: WALLET_ADDRESS, to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0' };
  let placed = false;
  const dex = { id: 'ord-0031', clientId: 'c0ffee00c0ffee00', venue: 'dex', status: 'pending', walletTxs: [tx] };
  // the ticket's liveOrder answered with an order built for the wallet; a cancel's with that order taken back (it still has its
  // walletTxs and no ref, as the Account answers one: live-orders.ts)
  const door = ownerDoor({ exchange: action => (action.type === 'liveCancel'
    ? { ok: true, kind: 'order', order: { ...dex, id: action.order, status: 'canceled' } }
    : { ok: true, kind: 'order', order: dex }) });
  const page = () => { const p = door.page(); return { ...p, orders: [placed ? { ...dex, ref: '0xsent', status: 'open' } : dex, ...p.orders] }; };
  const post = async (path, body) => {
    if (path === '/data/account/live/order-sent') { door.posts.push([path, body]); placed = true; return { status: 200, body: { ok: true } }; }
    return door.post(path, body);
  };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost: post, getWallets: async () => [{ id: 'fake', name: 'Fake Wallet', icon: '', provider }] });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  // a cancel first: its answer reaches afterAction as kind cancel, and the wallet is never asked
  f.click({ tagName: 'BUTTON', dataset: { action: 'cancelOrder', venue: 'ex', order: 'ord-0010' } });
  await until(() => store.get().trade.said !== null, 'the cancel said');
  await settle();
  const cancelSaid = store.get().trade.said;
  assert.equal(provider.requests.length, 0, 'a cancel starts no wallet send');
  assert.deepEqual(store.get().account.wallet, {});
  assert.equal(store.get().trade.said, cancelSaid, "the cancel's line stays");
  // the ticket: a buy typed, prepared, signed
  f.click({ tagName: 'BUTTON', dataset: { action: 'openTicket', id: 'coin:BTC', side: 'buy' } });
  await settle();
  assert.equal(store.get().sheet.kind, 'order');
  f.fire('root', 'input', { target: { tagName: 'INPUT', type: 'text', id: 'tk-amount', name: 'amount', value: '25', dataset: { action: 'ticketField' } } });
  await until(() => store.get().sheet?.status === 'ready', 'the preparation');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => door.sent('/data/account/live/order-sent').length === 1, 'the report');
  assert.equal(door.sent('/data/account/exchange').at(-1).action.type, 'liveOrder');
  assert.equal(provider.count('eth_sendTransaction'), 1);
  assert.deepEqual(door.sent('/data/account/live/order-sent'), [{ order: 'ord-0031', hash: hashOf(1) }]);
  await until(() => store.get().trade.said === 'Fake Wallet sent it: 0xaaaaaa…aaa1', 'the words said');
  store.timers.clear();
});

test("a row whose hash the Account already holds reads Report again, and pressing it reports that hash without the wallet", async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  const provider = fakeProvider();
  const held = '0x' + 'bb'.repeat(32);
  const tx = { chainId: 8453, chainIdHex: '0x2105', from: WALLET_ADDRESS, to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0' };
  const pay = { id: 'pay-0012', at: '2026-11-01T14:03:00.000Z', kind: 'send', from: 'ex', to: 'ex', status: 'authorized', legs: [{ native: { walletTx: tx } }], live: { reported: held } };
  let taken = false;
  const door = ownerDoor();
  const page = () => ({ ...door.page(), payments: taken ? [] : [pay] });
  const post = async (path, body) => {
    if (path === '/data/account/live/sent') { door.posts.push([path, body]); taken = true; return { status: 200, body: { ok: true } }; }
    return door.post(path, body);
  };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost: post, getWallets: async () => [{ id: 'fake', name: 'Fake Wallet', icon: '', provider }] });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /<button type="button" class="btn-sm" data-action="sendFromWallet" data-payment="pay-0012">Report again<\/button>/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'sendFromWallet', payment: 'pay-0012' } });
  await until(() => door.sent('/data/account/live/sent').length === 1, 'the report');
  assert.deepEqual(door.sent('/data/account/live/sent'), [{ payment: 'pay-0012', hash: held }]);
  assert.equal(provider.requests.length, 0, 'the wallet is never asked');
  store.timers.clear();
});

// ── the Market half's sheets (plan 4a Task 3): Close…, Change… and Leverage… ──

const typeIn = (f, name, value) => f.fire('root', 'input', { target: { tagName: 'INPUT', type: 'text', name, value, dataset: { action: 'sheetField' } } });
// a working order's Change… key as Under way and a market's page draw it
const changeKeyRe = id => new RegExp(`data-action="openSheet" data-kind="amend" data-venue="ex" data-order="${id}"[^>]*>Change…</button>`);

test('Under way offers Change… on a resting limit at a venue that amends, and opens the amend sheet', async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  const html = f.html();
  assert.match(html, /<button type="button" class="btn-sm" data-action="openSheet" data-kind="amend" data-venue="ex" data-order="ord-0002" data-type="limit" data-market-kind="spot" data-qty="0\.5" data-limit-price="142\.44" data-stop-price="" data-side="buy" data-base="SOL">Change…<\/button><button type="button" class="btn-sm" data-action="cancelOrder" data-venue="ex" data-order="ord-0002">Cancel<\/button>/);
  assert.match(html, changeKeyRe('ord-0004'), 'a stop rests too');
  assert.doesNotMatch(html, /data-kind="amend" data-venue="broker"/, 'the broker changes no order in place');
  // the key's data-*, as a browser hands them over
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'amend', venue: 'ex', order: 'ord-0002', type: 'limit', marketKind: 'spot', qty: '0.5', limitPrice: '142.44', stopPrice: '', side: 'buy', base: 'SOL' } });
  const sheet = store.get().sheet;
  assert.equal(sheet.kind, 'amend');
  assert.deepEqual(sheet.seed, { venue: 'ex', order: 'ord-0002', type: 'limit', kind: 'spot', qty: '0.5', limitPrice: '142.44', stopPrice: '', side: 'buy', base: 'SOL' });
  assert.deepEqual(sheet.fields.map(x => [x.name, x.placeholder]), [['qty', '0.5'], ['limitPrice', '142.44']]);
  assert.equal(sheet.status, 'incomplete', 'nothing typed: nothing to prepare');
  assert.match(f.html(), /<aside class="drawer sheet" aria-label="Change ord-0002">/);
  assert.match(f.html(), /Type what changes/);
  assert.equal(door.sent('/data/account/prepare').length, 0);
  typeIn(f, 'limitPrice', '143');
  await until(() => store.get().sheet?.status === 'ready', 'the preparation');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'liveAmend', venue: 'ex', order: 'ord-0002', qty: '', limitPrice: '143', stopPrice: '' });
  assert.match(f.html(), /data-action="sheetSubmit">Sign and change<\/button>/, 'the go key is on');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => door.sent('/data/account/exchange').length === 1, 'the signature');
  assert.equal(door.sent('/data/account/exchange')[0].action.type, 'liveAmend');
  store.timers.clear();
});

test("the Portfolio's BTC perpetual offers Close… and Leverage…", async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await until(() => /aria-label="Positions"/.test(f.html()), 'the positions');
  const html = f.html();
  assert.match(html, /data-action="openSheet" data-kind="close" data-venue="ex" data-symbol="BTC\/USDT:USDT" data-name="BTC perpetual" data-side="long" data-qty="0\.01" data-market-kind="perp">Close…<\/button>/);
  assert.match(html, /data-action="openSheet" data-kind="leverage" data-venue="ex" data-venue-name="Stand-in Exchange" data-symbol="BTC\/USDT:USDT" data-name="BTC perpetual" data-leverage="3">Leverage…<\/button>/);
  assert.match(html, /data-kind="close" data-venue="predict" data-symbol="SI-FEDCUT-DEC:YES"[^>]*data-market-kind="event">Sell…<\/button>/, 'an event is sold');
  assert.doesNotMatch(html, /data-kind="leverage" data-venue="predict"/, 'no leverage on an event');
  // Close…: blank closes all of it, so the sheet prepares at once
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'close', venue: 'ex', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', side: 'long', qty: '0.01', marketKind: 'perp' } });
  assert.equal(store.get().sheet.kind, 'close');
  await until(() => store.get().sheet?.status === 'ready', 'the close prepared');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'liveClose', venue: 'ex', symbol: 'BTC/USDT:USDT', qty: '' });
  assert.match(f.html(), /aria-label="Close BTC perpetual"[\s\S]*How much[\s\S]*placeholder="All 0\.01"[\s\S]*>Sign and close<\/button>/);
  // Leverage…: a whole number typed, prepared after the quiet
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'leverage', venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', leverage: '3', maxLeverage: '20', marginModes: 'cross,isolated' } });
  assert.equal(store.get().sheet.kind, 'leverage');
  assert.match(f.html(), /aria-label="Leverage · BTC perpetual"[\s\S]*placeholder="3"[\s\S]*<option value="" selected>Keep it<\/option>/);
  typeIn(f, 'leverage', '5');
  await until(() => store.get().sheet?.status === 'ready', 'the leverage prepared');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'liveLeverage', venue: 'ex', symbol: 'BTC/USDT:USDT', leverage: '5', marginMode: '' });
  store.timers.clear();
});

test("an owner action taken on a market's page reads its asset sheet again, past the face's cache", async () => {
  const f = fakeWindow({ hash: '#/markets/perp:BTC', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await until(() => /aria-label="You here"[\s\S]*data-kind="close"/.test(f.html()), 'You here with its Close…');
  assert.deepEqual(h.reads.filter(p => p.startsWith('/data/account/asset')), ['/data/account/asset?key=crypto%3ABTC'], 'once on entering');
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'close', venue: 'ex', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', side: 'long', qty: '0.01', marketKind: 'perp' } });
  await until(() => store.get().sheet?.status === 'ready', 'the close prepared');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => door.sent('/data/account/exchange').length === 1, 'the signature');
  await until(() => h.reads.includes('/data/account/asset?key=crypto%3ABTC&fresh=1'), 'the asset sheet read again');
  assert.equal(door.sent('/data/account/exchange')[0].action.type, 'liveClose');
  store.timers.clear();
});

test('a read-only page draws none of the three', async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  const door = ownerDoor();
  const readOnly = () => { const p = door.page(); return { ...p, connectLive: { ...p.connectLive, writes: { on: false, capUsd: 250 } } }; };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': readOnly } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  const none = /data-kind="(close|amend|leverage)"/;
  assert.match(f.html(), /data-action="cancelOrder" data-venue="ex" data-order="ord-0002">Cancel</, 'Cancel stays: the safer direction');
  assert.doesNotMatch(f.html(), none, 'Under way');
  f.win.location.hash = '#/account/portfolio';
  await until(() => /aria-label="Positions"/.test(f.html()), 'the positions');
  assert.doesNotMatch(f.html(), none, 'the Portfolio');
  store.timers.clear();
});

test('an order the stream reports filled while its Change… sheet is open', async () => {
  const f = fakeWindow({ hash: '#/trade', storage: memoryStorage() });
  const st = fakeStream();
  const door = ownerDoor();
  let filled = false;
  // the page once ord-0010 has filled: no longer working
  const page = () => { const p = door.page(); return filled ? { ...p, orders: p.orders.map(o => (o.id === 'ord-0010' ? { ...o, status: 'filled', filledQty: o.qty } : o)) } : p; };
  // the Account's answer to a change of an order that filled: its 409, in its words
  const REFUSAL = { code: 'E_ACCOUNT_BAD_ACTION', message: 'ord-0010 is filled: there is nothing to change at the venue', venue: 'ex', detail: { order: 'ord-0010' } };
  const post = async (path, body) => (path === '/data/account/prepare' && filled && body.draft?.type === 'liveAmend'
    ? (door.posts.push([path, body]), { status: 409, body: { ok: false, refusal: REFUSAL } }) : door.post(path, body));
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost: post, createAccountStream: st.create });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), changeKeyRe('ord-0010'));
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'amend', venue: 'ex', order: 'ord-0010', type: 'limit', marketKind: 'spot', qty: '0.707', limitPrice: '141.44', stopPrice: '', side: 'buy', base: 'SOL' } });
  assert.equal(store.get().sheet.kind, 'amend');
  // it fills: the stream says so, and the page is read again past the cache
  filled = true;
  h.reads.length = 0;
  st.event('fill', { side: 'buy', qty: 0.707, symbol: 'SOL/USDT', price: 141.44, venueName: 'Stand-in Exchange' }, 'r.1');
  await until(() => h.reads.includes('/data/account?fresh=1'), 'the page read fresh');
  await settle();
  // the order and its key are gone from Under way; the sheet stays open on what was asked
  assert.doesNotMatch(f.html(), /data-order="ord-0010"/, 'the row and its keys are gone');
  assert.match(f.html(), changeKeyRe('ord-0002'), 'the others stay');
  assert.equal(store.get().sheet?.kind, 'amend');
  // a change typed: the Account refuses it in its words, and nothing signs for a gone order
  typeIn(f, 'limitPrice', '140');
  await until(() => store.get().sheet?.status === 'refused', 'the refusal');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'liveAmend', venue: 'ex', order: 'ord-0010', qty: '', limitPrice: '140', stopPrice: '' });
  const html = f.html();
  assert.match(html, /<p class="acct-note">ord-0010 is filled: there is nothing to change at the venue<\/p>/);
  assert.match(html, /<button type="button" class="btn-primary" data-action="sheetSubmit" disabled>Sign and change<\/button>/, 'the go key stays off');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await settle();
  assert.equal(door.sent('/data/account/exchange').length, 0, 'nothing signed');
  store.timers.clear();
});

test('Run on a card opens the sheet; Escape closes it; Run sends the message, the page moves to the new conversation', async () => {
  const f = fakeWindow({ hash: '' });
  const close = f.withSelector('.drawer .close-key', { tagName: 'BUTTON', presentIf: /run-sheet/ });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  f.win.location.hash = '#/discover';
  await settle();
  const runKey = { tagName: 'BUTTON', dataset: { action: 'runModule', module: 'theme' } };
  f.click(runKey);
  await settle();
  let html = f.html();
  assert.match(html, /<div class="drawer sheet run-sheet" role="dialog" aria-label="Run Theme"><div class="drawer-head"><h2>Run Theme<\/h2>/);
  assert.match(html, /<select class="input" name="where" data-action="runSheetField" disabled><option value="cn-market" selected>cn-market<\/option><\/select>/);
  assert.match(html, /<label class="opt off"><input type="radio" name="on" value="latest" disabled data-action="runSheetField">[\s\S]*?theme already there/);
  assert.match(html, /<label class="opt on"><input type="radio" name="on" value="new" checked data-action="runSheetField"><span>New run<\/span>/);
  assert.ok(html.includes('boards missing in the last run'), "Theme's source line");
  assert.ok(html.includes('>Runs via</span>'));
  assert.ok(html.includes('Gravit in cn-market → CN market analyst, theme alone'));
  assert.match(html, /<button type="button" class="btn-primary" data-action="runSheetRun">Run<\/button>/);
  assert.equal(f.doc.activeElement, close, 'the sheet takes focus on its close key');
  // a note typed reaches the sheet; Escape closes it and the sheet opens fresh again
  f.fire('root', 'input', { target: { tagName: 'TEXTAREA', id: 'run-note', name: 'note', value: 'x', dataset: { action: 'runSheetField' } } });
  await settle();
  assert.equal(store.get().runSheet.note, 'x');
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'radio', name: 'on', value: 'latest', dataset: { action: 'runSheetField' } } });
  await settle();
  assert.equal(store.get().runSheet.on, 'latest', 'a pick reaches the sheet on change');
  assert.match(f.html(), /data-action="runSheetRun" disabled title="theme already there">Run</);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().runSheet, null);
  assert.doesNotMatch(f.html(), /role="dialog"/);
  f.click(runKey);
  await settle();
  assert.equal(store.get().runSheet.note, '');
  f.click({ tagName: 'BUTTON', dataset: { action: 'runSheetRun' } });
  await settle();
  const d = new Date();
  const title = `Theme · ${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.deepEqual(h.calls.filter(c => c[0] !== 'session/list' && c[0] !== 'session/projections' && c[0] !== 'session/page').map(c => c[0]), ['session/create', 'session/rename', 'session/prompt']);
  assert.deepEqual(h.calls.find(c => c[0] === 'session/create')[1], { request: { workspaceId: 'ws-cn-market' } });
  assert.equal(h.calls.find(c => c[0] === 'session/rename')[1].request.title, title);
  assert.equal(h.calls.find(c => c[0] === 'session/prompt')[1].request.content[0].text,
    '请只跑 Lunhui 的 theme 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 theme。');
  assert.deepEqual(store.get().route, { screen: 'messages', id: 's-new' });
  assert.equal(store.get().runSheet, null);
  assert.equal(store.get().moduleRuns.theme.sessionId, 's-new');
  assert.equal(store.get().moduleRuns.theme.title, title);
  assert.doesNotMatch(f.html(), /role="dialog"/);
  store.timers.clear();
});

test('a Latest run that is no longer the latest is drawn greyed but pickable; picking it again re-stamps the run and Run opens', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1')] });
  const listing = modulesListing();
  delete listing.channels[0].runs[0].artifacts.sentiment;
  h.inventory['/data/modules.json'] = listing;
  const store = started(f, h);
  await h.ready();
  f.win.location.hash = '#/discover';
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'runModule', module: 'sentiment' } });
  await settle();
  assert.equal(store.get().runSheet.on, 'latest');
  const first = store.get().runSheet.run;
  // the listing moves: a newer cn-market run lands while the sheet is open
  const NEWER = '20261029T020000Z-aaaaaaaa';
  const moved = modulesListing();
  delete moved.channels[0].runs[0].artifacts.sentiment;
  moved.channels[0].runs.unshift({ run: NEWER, session: '2026-10-29', asOf: null, openedAt: null, sealedAt: '2026-10-29T02:00:00.000Z', frozen: ['index', 'limit-up', 'boards'], artifacts: {} });
  h.inventory['/data/modules.json'] = moved;
  f.click({ tagName: 'BUTTON', dataset: { action: 'runSheetRun' } });
  await settle();
  assert.equal(store.get().runSheet.said, 'run no longer the latest');
  assert.equal(store.get().runSheet.run, first);
  assert.ok(!h.calls.some(c => c[0] === 'session/create'), 'nothing sent');
  let html = f.html();
  assert.match(html, /<label class="opt off"><input type="radio" name="on" value="latest" data-action="runSheetField"><span>Latest run · 20261029T020000Z-aaaaaaaa · session 2026-10-29<\/span><p class="sheet-hint">run no longer the latest<\/p>/,
    'greyed with its reason, neither disabled nor checked, so a click on it is a change');
  assert.match(html, /data-action="runSheetRun" disabled title="run no longer the latest">Run</);
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'radio', name: 'on', value: 'latest', dataset: { action: 'runSheetField' } } });
  await settle();
  assert.equal(store.get().runSheet.run, NEWER, 're-stamped with the newest run');
  html = f.html();
  assert.match(html, /<label class="opt on"><input type="radio" name="on" value="latest" checked data-action="runSheetField">/);
  assert.match(html, /<button type="button" class="btn-primary" data-action="runSheetRun">Run<\/button>/);
  store.timers.clear();
});

test('after Run the card reads Running and links to the conversation; when the session stops the listing is re-read and the chip settles', async () => {
  const storage = memoryStorage();
  const f = fakeWindow({ hash: '', storage });
  const h = host({ rows: [row('s1')] });
  const clock = { at: Date.now() };
  const timers = new HeldTimers(ms => ms === 5000);
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, timers, now: () => clock.at });
  await h.ready();
  f.win.location.hash = '#/discover';
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'runModule', module: 'theme' } });
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'runSheetRun' } });
  await settle();
  assert.deepEqual(store.get().route, { screen: 'messages', id: 's-new' });
  const d = new Date(clock.at);
  const title = `Theme · ${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.deepEqual(JSON.parse(storage.getItem('gravit-face.module-runs')), { theme: { sessionId: 's-new', title, startedAt: clock.at } }, 'mirrored to storage');
  // back on Discover: the theme card is live and links to the conversation, its Run off; the other cards as they were
  f.win.location.hash = '#/discover';
  await settle();
  const card = () => f.html().match(/<div class="pcard research in-grid"><a class="pcard-link" href="#\/module\/theme">[\s\S]*?<\/button><\/span><\/div>/)?.[0] ?? '';
  assert.ok(card().includes(`<a class="chip live" href="#/messages/s-new">Running · ${title} ›</a>`), card());
  assert.match(card(), /data-action="runModule" data-module="theme" disabled title="Running">Run</);
  assert.ok(f.html().includes('>IGNITION · POSITIVE · NONE</span>'), 'sentiment keeps its chip');
  // the module page reads the same
  f.win.location.hash = '#/module/theme';
  await settle();
  assert.ok(f.html().includes(`<a class="chip live" href="#/messages/s-new">Running · ${title} ›</a>`));
  assert.match(f.html(), /data-action="runModule" data-module="theme" disabled title="Running">Run</);
  f.win.location.hash = '#/discover';
  await settle();
  // the session runs past the minute: still Running, nothing re-read
  const listed = () => h.reads.filter(p => p === '/data/modules.json').length;
  const before = listed();
  h.rows.find(r => r.sessionId === 's-new').running = true;
  await store.live.refresh();
  clock.at += 61_000;
  await store.live.refresh();
  await settle();
  assert.equal(store.get().moduleRuns.theme.sessionId, 's-new');
  assert.equal(listed(), before);
  // it stops: the record goes, the listing is read again now and once more 5 s later, the chip back to the listing's words
  h.rows.find(r => r.sessionId === 's-new').running = false;
  await store.live.refresh();
  await settle();
  assert.equal(store.get().moduleRuns.theme, undefined);
  assert.equal(listed(), before + 1);
  assert.ok(card().includes('<span class="chip warn">not evaluable · boards</span>'), card());
  assert.doesNotMatch(card(), /disabled/);
  assert.deepEqual(JSON.parse(storage.getItem('gravit-face.module-runs')), {});
  assert.deepEqual(timers.delays(), [5000]);
  timers.run(5000);
  await settle();
  assert.equal(listed(), before + 2);
  store.timers.clear();
});

// plan 2 of the Lunhui run view, task 4: an ok lunhui_present result draws a composed answer that reads its run's view; a
// failed read (the face restarted, the run deleted) shows its summary, one error line and Retry, and Retry reads it again
test('a composed answer reads its view; a 404 draws the summary, the error line and Retry; Retry reads again and the skeletons go', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const views = [];
  let answer = () => { throw Object.assign(new Error('gone: HTTP 404'), { status: 404 }); };
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, postJson: h.postJson, markdown: null,
    getJson: async path => (path.startsWith('/data/lunhui/view?') ? (views.push(path), answer()) : h.getJson(path)) });
  await h.ready();
  const follow = [...h.streams].reverse().find(x => x.name === 'session/follow' && x.args.request.address.sessionId === 's1');
  follow.cbs.onItem({ type: 'snapshot', records: [] });
  const args = { strategy: 'cn-market', run: '20261027T201627Z-6937d208', summary: '弱势日，跌多涨少。', blocks: [{ kind: 'ladder' }] };
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'k1', name: 'lunhui_present', arguments: JSON.stringify(args) } } });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/result', seq: 41, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId: 'k1' }, toolCallId: 'k1', content: [{ type: 'text', text: JSON.stringify({ ok: true, blocks: ['ladder'], modules: [] }) }], isError: false } } } });
  await settle();
  assert.deepEqual(views, ['/data/lunhui/view?strategy=cn-market&run=20261027T201627Z-6937d208&modules=']);
  assert.match(f.html(), /class="msg-body composed"/);
  assert.match(f.html(), /弱势日，跌多涨少。/);
  assert.match(f.html(), /The run view could not be loaded: HTTP 404/);
  answer = () => ({ ok: true, view: { strategy: 'cn-market', run: args.run } });
  f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiRetry', key: 'cn-market/20261027T201627Z-6937d208/' } }));
  await settle();
  assert.equal(views.length, 2, 'Retry reads the view again');
  assert.doesNotMatch(f.html(), /could not be loaded|Drawing /);
  assert.equal(store.get().lunhui.views['cn-market/20261027T201627Z-6937d208/'].status, 'loaded');
});

// task 5: a composed answer's picks — a verdict tile opens and, pressed again, closes; By change; a bucket held as a number
test('a composed answer: a tile opens and closes, By change switches, a bucket is picked by number', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, postJson: h.postJson, markdown: null,
    getJson: async path => (path.startsWith('/data/lunhui/view?') ? { ok: true, view: VIEW_1027 } : h.getJson(path)) });
  await h.ready();
  const follow = [...h.streams].reverse().find(x => x.name === 'session/follow' && x.args.request.address.sessionId === 's1');
  follow.cbs.onItem({ type: 'snapshot', records: [] });
  const args = { strategy: 'cn-market', run: VIEW_1027.run, summary: '弱势日。', blocks: [{ kind: 'verdicts' }, { kind: 'breadth' }] };
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'k1', name: 'lunhui_present', arguments: JSON.stringify(args) } } });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/result', seq: 41, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId: 'k1' }, toolCallId: 'k1', content: [{ type: 'text', text: JSON.stringify({ ok: true, blocks: ['verdicts', 'breadth'], modules: [] }) }], isError: false } } } });
  await settle();
  const id = 's1-pk1';
  const press = (field, value) => f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiUi', id, field, value } }));
  assert.match(f.html(), /Up\/down ratio 0\.12/);
  press('tile', 'environment');
  assert.equal(store.get().lunhui.ui[id].tile, 'environment');
  assert.match(f.html(), /data-value="environment" aria-expanded="true"/);
  press('tile', 'environment');
  assert.equal(store.get().lunhui.ui[id].tile, null, 'pressed again, the tile closes');
  press('breadth', 'dist');
  press('bucket', '-6');
  assert.equal(store.get().lunhui.ui[id].bucket, -6);
  assert.match(f.html(), /Bucket −6: 458 stocks · 8\.5% of 5,375/);
});

// plan 3, task 2: a stock name in a composed answer opens the stock drawer's state — one overlay at a time; nav and Escape close it
async function stockAnswer(more = {}) {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, postJson: h.postJson, markdown: null,
    getJson: async path => (path.startsWith('/data/lunhui/view?') ? { ok: true, view: VIEW_1027 } : h.getJson(path)), ...more });
  await h.ready();
  const follow = [...h.streams].reverse().find(x => x.name === 'session/follow' && x.args.request.address.sessionId === 's1');
  follow.cbs.onItem({ type: 'snapshot', records: [] });
  const args = { strategy: 'cn-market', run: VIEW_1027.run, summary: '上海九百五连板。', blocks: [{ kind: 'ladder' }] };
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'k1', name: 'lunhui_present', arguments: JSON.stringify(args) } } });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/result', seq: 41, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId: 'k1' }, toolCallId: 'k1', content: [{ type: 'text', text: JSON.stringify({ ok: true, blocks: ['ladder'], modules: [] }) }], isError: false } } } });
  await settle();
  const key = `cn-market/${VIEW_1027.run}/`;
  const open = () => f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiStock', key, code: '600001' } }));
  return { f, store, key, open, h, follow };
}

test('clicking a stock link opens the drawer state and closes Details', async () => {
  const { f, store, key, open } = await stockAnswer();
  assert.ok(f.html().includes(`data-action="lunhuiStock" data-key="${key}" data-code="600001">上海九百</button>`), 'the summary and the ladder draw the link');
  store.dispatch('toggleDetails');
  assert.equal(store.get().detailsOpen, true);
  open();
  assert.deepEqual(store.get().lunhui.stock, { key, code: '600001' });
  assert.equal(store.get().detailsOpen, false, 'one overlay at a time');
  store.dispatch('toggleDetails');
  assert.equal(store.get().lunhui.stock, null, 'opening Details closes the stock');
  store.timers.clear();
});

test('navigating away clears the open stock', async () => {
  const { f, store, open } = await stockAnswer();
  open();
  assert.ok(store.get().lunhui.stock);
  f.win.location.hash = '#/discover';
  f.fire('win', 'hashchange');
  await settle();
  assert.equal(store.get().route.screen, 'discover');
  assert.equal(store.get().lunhui.stock, null);
  store.timers.clear();
});

test('Escape clears the open stock', async () => {
  const { f, store, open } = await stockAnswer();
  open();
  assert.ok(store.get().lunhui.stock);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().lunhui.stock, null);
  store.timers.clear();
});

// plan 3, task 4: the stock drawer itself — drawn inside <main>, its slider surviving a live redraw (Review Focus 2), Details
// replacing it, Ask Gravit through the composer's own send path, Open in Markets
test('the drawer survives a live redraw with its slider minute', async () => {
  const { f, store, key, open, follow } = await stockAnswer();
  open();
  const id = 's-600001';
  assert.match(f.html(), /<aside class="drawer stock" aria-label="上海九百">/);
  assert.match(f.html(), /<main class="main with-drawer with-stock">/);
  assert.match(f.html(), new RegExp(`id="minute-${id}"`));
  assert.match(f.html(), /<aside class="drawer stock"[\s\S]*<\/main>/, 'inside <main>, like the other drawers');
  const where = { id, strategy: VIEW_1027.strategy, run: VIEW_1027.run, symbol: 'sh600001' };
  const drawn = { x1: '708', x2: '708' };
  const cur = f.withId(`cur-${id}`, { attributes: { ...drawn }, renderedAttributes: drawn });
  const read = f.withId(`read-${id}`);
  const slider = f.withId(`minute-${id}`, { tagName: 'INPUT', type: 'range', rendered: '241', value: '241', max: '241', dataset: { action: 'lunhuiMinute', ...where } });
  f.alsoAs('input[data-action="lunhuiMinute"]', slider);
  const X = i => Number((56 + i / 241 * 652).toFixed(1));
  slider.value = '120';
  f.fire('root', 'input', { target: slider });
  assert.equal(Number(cur.attributes.x1), X(120));
  assert.equal(read.textContent, '上海九百 · 11:30 · 13.31 · +10.00% · at the limit-up');
  const writes = f.writes;
  // a live event redraws the thread while the operator holds the slider at 11:30
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 42, time: 1756512202000, data: { turn: 5, step: 1, callId: 'k2', name: 'bash', arguments: '{}' } } });
  await settle();
  assert.ok(f.writes > writes, 'the event redrew the page');
  assert.deepEqual(store.get().lunhui.stock, { key, code: '600001' }, 'the drawer stays open');
  assert.match(f.html(), /class="drawer stock"/);
  assert.equal(slider.value, '120', 'the render restored the slider');
  assert.equal(Number(cur.attributes.x1), X(120), 'and the cursor stands at its minute again');
  store.timers.clear();
});

test('opening Details replaces the stock drawer', async () => {
  const { f, store, open } = await stockAnswer();
  open();
  assert.match(f.html(), /class="drawer stock"/);
  f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } }));
  assert.equal(store.get().lunhui.stock, null);
  assert.doesNotMatch(f.html(), /class="drawer stock"|with-stock/);
  assert.match(f.html(), /class="drawer details"/);
  open();
  f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiStockClose' } }));
  assert.equal(store.get().lunhui.stock, null, 'its Close key closes it');
  assert.doesNotMatch(f.html(), /class="drawer stock"/);
  store.timers.clear();
});

test("Ask Gravit sends one message through the composer's path", async () => {
  const { f, store, open, h } = await stockAnswer();
  const say = f.withId('say', { tagName: 'INPUT' });
  say.value = 'half a thought';
  f.fire('root', 'input', { target: say });
  open();
  const before = h.calls.filter(c => c[0] === 'session/prompt').length;
  f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiAsk', code: '600001' } }));
  await settle();
  const prompts = h.calls.filter(c => c[0] === 'session/prompt');
  assert.equal(prompts.length, before + 1, 'one message');
  assert.equal(prompts.at(-1)[1].request.sessionId, 's1');
  assert.deepEqual(prompts.at(-1)[1].request.content, [{ type: 'text', text: '说说 上海九百（600001）在这次运行里的情况。' }]);
  assert.equal(say.value, 'half a thought', 'the composer keeps what was typed');
  store.timers.clear();
});

test('Open in Markets routes to cn:<code>', async () => {
  const { f, store, open, h } = await stockAnswer();
  open();
  f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiMarkets', code: '600001' } }));
  await settle();
  assert.equal(f.win.location.hash, '#/markets/cn:600001');
  assert.deepEqual(store.get().route, { screen: 'markets', id: 'cn:600001' });
  assert.match(f.html(), /<main class="main mkts mk-page">[\s\S]*A-share · 600001 · SH/, 'the A-share page, reached cold');
  assert.ok(h.reads.includes('/data/account/candles?venue=china&symbol=600001&range=1D'), 'its history at venue china');
  assert.equal(store.get().lunhui.stock, null, 'leaving the conversation closes the drawer');
  store.timers.clear();
});

// task 6: the indices block's minute cursor — the slider and the pointer move it in place with no store change and no render;
// a redraw that lands mid-drag (a live event) draws the cursor at the last minute, and the page puts it back at the slider's
test('the minute cursor: the slider and the pointer patch the chart in place; a redraw mid-drag keeps the slider\'s minute', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, postJson: h.postJson, markdown: null,
    getJson: async path => (path.startsWith('/data/lunhui/view?') ? { ok: true, view: VIEW_1027 } : h.getJson(path)) });
  await h.ready();
  const follow = [...h.streams].reverse().find(x => x.name === 'session/follow' && x.args.request.address.sessionId === 's1');
  follow.cbs.onItem({ type: 'snapshot', records: [] });
  const args = { strategy: 'cn-market', run: VIEW_1027.run, summary: '弱势日。', blocks: [{ kind: 'indices', focus: { from: '14:00', to: '15:00' } }] };
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'k1', name: 'lunhui_present', arguments: JSON.stringify(args) } } });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/result', seq: 41, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId: 'k1' }, toolCallId: 'k1', content: [{ type: 'text', text: JSON.stringify({ ok: true, blocks: ['indices'], modules: [] }) }], isError: false } } } });
  await settle();
  const id = 's1-pk1';
  assert.match(f.html(), new RegExp(`id="minute-${id}"`));
  // the page's own nodes, as a redraw leaves them: the cursor at 15:00, the slider at its max
  const where = { id, strategy: VIEW_1027.strategy, run: VIEW_1027.run, symbol: 'sh000001' };
  const drawn = { x1: '708', x2: '708' };
  const cur = f.withId(`cur-${id}`, { attributes: { ...drawn }, renderedAttributes: drawn });
  const dot = f.withId(`dot-${id}`, { attributes: { cx: '708' }, renderedAttributes: { cx: '708' } });
  const read = f.withId(`read-${id}`);
  const slider = f.withId(`minute-${id}`, { tagName: 'INPUT', type: 'range', rendered: '241', value: '241', max: '241', dataset: { action: 'lunhuiMinute', ...where } });
  f.alsoAs('input[data-action="lunhuiMinute"]', slider);
  const X = i => Number((56 + i / 241 * 652).toFixed(1));
  const before = store.get(), writes = f.writes;
  slider.value = '120';
  f.fire('root', 'input', { target: slider });
  assert.equal(Number(cur.attributes.x1), X(120));
  assert.equal(Number(dot.attributes.cx), X(120));
  assert.match(read.textContent, /^上证指数 · 11:30 · /);
  assert.equal(store.get(), before, 'the slider changes no state');
  assert.equal(f.writes, writes, 'and draws nothing');
  // the pointer over the chart: 10:00 is point 30
  const chart = f.element({ dataset: { action: 'lunhuiHover', last: '241', ...where }, getBoundingClientRect: () => ({ left: 0, width: 760 }) });
  f.fire('root', 'pointermove', { target: { closest: sel => (sel === '[data-action="lunhuiHover"]' ? chart : null) }, clientX: X(30) });
  assert.match(read.textContent, /^上证指数 · 10:00 · 3712\.31 · /);
  assert.equal(store.get(), before, 'the pointer changes no state');
  assert.equal(f.writes, writes);
  // Review Focus 4: the operator holds the slider at 120 and a live event redraws the page
  slider.value = '120';
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 42, time: 1756512202000, data: { turn: 5, step: 1, callId: 'k2', name: 'bash', arguments: '{}' } } });
  await settle();
  assert.ok(f.writes > writes, 'the event redrew the page');
  assert.equal(slider.value, '120', 'the render restored the slider');
  assert.equal(Number(cur.attributes.x1), X(120), 'and the cursor stands at the slider\'s minute again');
  assert.equal(Number(cur.attributes.x2), X(120));
});

// plan 3, task 5: a composed answer's follow-ups and Open run
async function choiceAnswer(choices) {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, postJson: h.postJson, markdown: null,
    getJson: async path => (path.startsWith('/data/lunhui/view?') ? { ok: true, view: VIEW_1027 }
      : path === '/data/channels.json' ? { ok: true, root: '/r', channels: [{ workspaceId: 'w-cn', name: VIEW_1027.strategy, isRoot: false, sessionIds: ['s1'] }], ungrouped: [], archived: [], presets: {} }
      : h.getJson(path)) });
  await h.ready();
  const follow = [...h.streams].reverse().find(x => x.name === 'session/follow' && x.args.request.address.sessionId === 's1');
  follow.cbs.onItem({ type: 'snapshot', records: [] });
  const args = { strategy: VIEW_1027.strategy, run: VIEW_1027.run, summary: '弱势日。', blocks: [{ kind: 'ladder' }], choices };
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/call', seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: 'k1', name: 'lunhui_present', arguments: JSON.stringify(args) } } });
  follow.cbs.onItem({ type: 'event', event: { type: 'tool/result', seq: 41, time: 1756512201000, surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm-41', role: 'tool', source: { kind: 'tool', callId: 'k1' }, toolCallId: 'k1', content: [{ type: 'text', text: JSON.stringify({ ok: true, blocks: ['ladder'], modules: [] }) }], isError: false } } } });
  await settle();
  return { f, store, h };
}
const prompts = h => h.calls.filter(c => c[0] === 'session/prompt');

test('a plain choice sends its label once per click', async () => {
  const { f, store, h } = await choiceAnswer([{ label: '再看龙头' }]);
  const before = prompts(h).length;
  const btn = f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiChoice', label: '再看龙头' } });
  f.click(btn);
  await settle();
  assert.equal(prompts(h).length, before + 1);
  assert.deepEqual(prompts(h).at(-1)[1].request.content, [{ type: 'text', text: '再看龙头' }]);
  f.click(btn);
  await settle();
  assert.equal(prompts(h).length, before + 2, 'two clicks, two sends');
  store.timers.clear();
});

test('a choice with markup in its label sends it as plain text', async () => {
  const label = '<b>x</b> & "y"';
  const { f, store, h } = await choiceAnswer([{ label }]);
  assert.doesNotMatch(f.html(), /<b>x<\/b>/);
  f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiChoice', label } }));
  await settle();
  assert.deepEqual(prompts(h).at(-1)[1].request.content, [{ type: 'text', text: label }]);
  store.timers.clear();
});

test('a stock choice opens the drawer', async () => {
  const { f, store, h } = await choiceAnswer([{ label: '看上海九百', stock: 'sh600001' }]);
  assert.match(f.html(), /data-action="lunhuiChoice" data-key="[^"]+" data-label="看上海九百" data-code="600001"/);
  const before = prompts(h).length;
  f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiChoice', label: '看上海九百', key: `${VIEW_1027.strategy}/${VIEW_1027.run}/`, code: '600001' } }));
  await settle();
  assert.deepEqual(store.get().lunhui.stock, { key: `${VIEW_1027.strategy}/${VIEW_1027.run}/`, code: '600001' });
  assert.equal(prompts(h).length, before, 'nothing sent');
  store.timers.clear();
});

test('Open run goes to the channel page', async () => {
  const { f, store } = await choiceAnswer([]);
  assert.match(f.html(), /data-action="lunhuiOpenRun" data-id="w-cn">Open run ›/);
  f.click(f.element({ tagName: 'BUTTON', dataset: { action: 'lunhuiOpenRun', id: 'w-cn' } }));
  await settle();
  assert.deepEqual(store.get().route, { screen: 'channel', id: 'w-cn' });
  store.timers.clear();
});

// ── Rules (plan 4a Task 5): Guard is one unsigned click, on any page that reads the Account ──

test('Guard pressed twice in a row on a page that does not sign: one POST to /data/account/guard, the said line once; Beast opens no sheet', async () => {
  const f = fakeWindow({ hash: '#/account/rules', storage: memoryStorage() });
  const door = ownerDoor({ role: 'needs-code' });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(() => store.get().owner.role === 'needs-code', 'the page to need the code');
  await settle();
  assert.match(f.html(), /data-action="setGuard">Guard<\/button>/);
  assert.match(f.html(), /aria-pressed="false" disabled>Beast<\/button>/);
  assert.match(f.html(), /Only a browser that signs switches to Beast\./);
  const pagesBefore = h.reads.filter(isPage).length;
  f.click({ tagName: 'BUTTON', dataset: { action: 'setGuard' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'setGuard' } });
  await settle();
  assert.equal(door.sent('/data/account/guard').length, 1, 'one POST');
  assert.deepEqual(door.sent('/data/account/guard')[0], {});
  const said = f.html().match(/<p class="acct-note">Guard: what agents ask for waits for you on a card\.<\/p>/g) ?? [];
  assert.equal(said.length, 1, 'the said line once');
  assert.ok(h.reads.filter(isPage).slice(pagesBefore).includes('/data/account?fresh=1'), 'the page read fresh');
  // Beast: no key on this page; were one pressed, no sheet
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'beast' } });
  await settle();
  assert.equal(store.get().sheet, null);
  assert.equal(door.sent('/data/account/prepare').length, 0);
  store.timers.clear();
});

test('on a page that signs, Beast and the three Change keys open their signed sheets, each prepared as the Account drafts it', async () => {
  const f = fakeWindow({ hash: '#/account/rules', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  const html = f.html();
  for (const kind of ['beast', 'cap', 'session', 'leverageCap']) assert.match(html, new RegExp(`data-action="openSheet" data-kind="${kind}"`), kind);
  const open = async kind => {
    f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind } });
    await settle();
    return store.get().sheet;
  };
  assert.equal((await open('beast')).kind, 'beast');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'setPolicy', change: 'mode', value: 'open' });
  assert.equal((await open('session')).seed.ended, false);
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'setPolicy', change: 'session', value: '30d' });
  const cap = await open('cap');
  assert.deepEqual(cap.seed, { capUsd: 250 });
  assert.match(f.html(), /That is the cap now/);
  const lev = await open('leverageCap');
  assert.deepEqual(lev.seed, { max: 5 });
  assert.match(f.html(), /That is their leverage now/);
  store.timers.clear();
});

test('Guard said, then Beast signed: the said line goes with Guard, and Beast in force opens no sheet', async () => {
  const f = fakeWindow({ hash: '#/account/rules', storage: memoryStorage() });
  let mode = 'guard';
  const door = ownerDoor({ exchange: action => { if (action?.type === 'setPolicy' && action.change === 'mode') mode = action.value; return { ok: true, kind: 'result', result: { ok: true } }; } });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => ({ ...door.page(), mode }) } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  const SAID = '<p class="acct-note">Guard: what agents ask for waits for you on a card.</p>';
  f.click({ tagName: 'BUTTON', dataset: { action: 'setGuard' } });
  await settle();
  assert.ok(f.html().includes(SAID), 'Guard said');
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'beast' } });
  await until(() => store.get().sheet?.status === 'ready', 'the Beast sheet prepared');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().sheet === null && store.get().account.data?.mode === 'open', 'Beast signed and read');
  await settle();
  assert.equal(mode, 'open');
  assert.ok(!f.html().includes(SAID), 'the said line is gone');
  assert.match(f.html(), /<button type="button" class="seg-item pressed" aria-pressed="true">Beast<\/button>/);
  const prepares = door.sent('/data/account/prepare').length;
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'beast' } });
  await settle();
  assert.equal(store.get().sheet, null, 'Beast in force: no sheet');
  assert.equal(door.sent('/data/account/prepare').length, prepares);
  store.timers.clear();
});

// ── the Money tab (plan 4b Task 2) ──

test('the Money tab: Show address reads the row and draws it; Move… opens the move sheet, its fields follow the kind, and a bridge reads its routes', async () => {
  const f = fakeWindow({ hash: '#/account/money', storage: memoryStorage() });
  const mm = { id: 'wallet-mm', name: 'My wallet', live: true, watchOnly: 'Live · read-only', address: '0x' + '11'.repeat(20), proven: 'signed by its wallet', liveCan: { withdraw: false, ledgers: [], transfer: false, swap: false, receive: true, send: 'wallet' }, holdings: [] };
  const door = ownerDoor();
  const page = () => { const p = door.page(); return { ...p, venues: [...p.venues, mm] }; };
  const post = async (path, body) => {
    if (path === '/data/account/bridge-routes') { door.posts.push([path, body]); return { status: 200, body: { ok: true, routes: [{ tool: 'across', receiveUsd: 9.9, etaSec: 20, feeUsd: 0.1 }] } }; }
    return door.post(path, body);
  };
  const address = { ok: true, venue: 'agent-claude-code', asset: 'USDC', network: 'Base', address: '0x7f89224D3Ad6cACd933242ba0c07e1187e3467C2', whose: "the agent wallet's own address" };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page, '/data/account/receive': () => address } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost: post });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="showAddress" data-venue="agent-claude-code" data-asset="USDC" data-network="Base">Show address<\/button>/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'showAddress', venue: 'agent-claude-code', asset: 'USDC', network: 'Base' } });
  await until(() => store.get().account.receive['agent-claude-code|USDC|Base']?.status === 'ready', 'the address');
  assert.ok(h.reads.includes('/data/account/receive?venue=agent-claude-code&asset=USDC&network=Base'));
  assert.match(f.html(), /<span class="mono">0x7f89224D3Ad6cACd933242ba0c07e1187e3467C2<\/span>/);
  // Move… from the exchange: a withdrawal first; the kind changed to a swap drops its destination and network
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'move', from: 'ex' } });
  await settle();
  assert.equal(store.get().sheet.kind, 'move');
  assert.deepEqual(store.get().sheet.fields.map(x => x.name), ['from', 'kind', 'to', 'network', 'asset', 'amount']);
  f.fire('root', 'change', { target: { tagName: 'SELECT', name: 'kind', value: 'swap', dataset: { action: 'sheetField' } } });
  assert.deepEqual(store.get().sheet.fields.map(x => x.name), ['from', 'kind', 'asset', 'toAsset', 'amount']);
  f.fire('root', 'input', { target: { tagName: 'INPUT', type: 'text', name: 'amount', value: '10', dataset: { action: 'sheetField' } } });
  await until(() => store.get().sheet?.status === 'ready', 'the preparation');
  const swap = door.sent('/data/account/prepare').at(-1).draft;
  assert.deepEqual([swap.type, swap.kind, swap.from, swap.to, swap.network, swap.amount], ['liveMove', 'swap', 'ex', 'ex', '', '10']);
  assert.equal(door.sent('/data/account/bridge-routes').length, 0, 'a swap reads no routes');
  // a bridge from the proven wallet: its routes read after its preparation lands, and drawn beside it
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'move', from: 'wallet-mm', moveKind: 'bridge', amount: '10' } });
  await until(() => door.sent('/data/account/bridge-routes').length === 1, 'the routes');
  assert.equal(door.sent('/data/account/bridge-routes')[0].draft.kind, 'bridge');
  await until(() => /Via across/.test(f.html()), 'the routes drawn');
  assert.match(f.html(), /<b>Via across · at least \$9\.90 USDC arrives · ~20 s<\/b>/);
  store.timers.clear();
});

// ── Earn and Sell many (plan 4b Task 3) ──

test('the Money tab reads Earn; Put in… opens the Earn sheet, prepared as liveEarn, and a taken earn reads Earn again and says it', async () => {
  const { earnBody } = await import('./helpers/earn-fixture.js');
  const f = fakeWindow({ hash: '#/account/money', storage: memoryStorage() });
  const door = ownerDoor({ exchange: action => (action?.type === 'liveEarn'
    ? { ok: true, kind: 'result', result: { earn: { kind: 'supply', amount: 25, asset: 'USDT', productName: 'USDT · Flexible (stand-in)', status: 'done' } } }
    : { ok: true, kind: 'result', result: { ok: true } }) });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/earn': () => earnBody() } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await until(() => store.get().account.earn.status === 'ready', 'the earn read');
  assert.ok(h.reads.includes('/data/account/earn'), 'read on entering Money');
  await settle();
  assert.match(f.html(), /data-kind="earn" data-venue="ex" data-side="withdraw" data-product="flex:USDT">Take out…<\/button>/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'earn', side: 'supply' } });
  await settle();
  assert.equal(store.get().sheet.kind, 'earn');
  assert.match(f.html(), />Sign and put in<\/button>/);
  f.fire('root', 'input', { target: { tagName: 'INPUT', type: 'text', name: 'amount', value: '25', dataset: { action: 'sheetField' } } });
  await until(() => store.get().sheet?.status === 'ready', 'the preparation');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'liveEarn', venue: 'ex', kind: 'supply', product: 'flex:USDT', asset: 'USDT', amount: '25' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().sheet === null, 'the sheet closed once taken');
  await until(() => h.reads.includes('/data/account/earn?fresh=1'), 'earn read again past the cache');
  await settle();
  assert.match(f.html(), /Putting in 25 USDT · USDT · Flexible \(stand-in\): done/);
  store.timers.clear();
});

test('Sell many… on the Portfolio: the drawer reads what can be sold, a pick, Review, Sign — one signature, the Account read again', async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const door = ownerDoor({ exchange: action => (action?.type === 'liveOrder' ? { ok: true, kind: 'order', order: { id: 'ord-0042', status: 'filled' } } : { ok: true, kind: 'result', result: { ok: true } }) });
  const sellable = { ok: true, items: [
    { key: 'crypto:SOL', asset: 'SOL', venue: 'ex', venueName: 'Stand-in Exchange', action: 'sell', symbol: 'SOL/USDT', held: 25, sellQty: 25, usd: 3571.25, ready: true },
    { key: 'crypto:ETH', asset: 'ETH', venue: 'ex', venueName: 'Stand-in Exchange', action: 'sell', symbol: 'ETH/USDT', held: 1.8, sellQty: 1.8, ready: true },
  ], missing: [] };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/sellable': () => sellable } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="openSellMany">Sell many…<\/button>/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSellMany' } });
  await until(() => store.get().sellMany?.status === 'picking', 'what can be sold');
  assert.ok(h.reads.includes('/data/account/sellable?fresh=1'));
  assert.match(f.html(), /aria-label="Sell many"/);
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', name: 'pick', value: '1', checked: true, dataset: { action: 'sellManyPick' } } });
  f.fire('root', 'input', { target: { tagName: 'INPUT', type: 'text', value: '1', dataset: { action: 'sellManyQty', index: '1' } } });
  assert.deepEqual(store.get().sellMany.picked, [1]);
  f.click({ tagName: 'BUTTON', dataset: { action: 'sellManyReview' } });
  await until(() => store.get().sellMany?.legs?.[0]?.state === 'ready', 'the leg prepared');
  assert.deepEqual(door.sent('/data/account/prepare').at(-1).draft, { type: 'liveOrder', venue: 'ex', symbol: 'ETH/USDT', side: 'sell', orderType: 'market', qty: '1', limitPrice: '', stopPrice: '', tif: '', postOnly: '', reduceOnly: '' });
  await settle();
  assert.match(f.html(), />Sign 1<\/button>/);
  const pagesBefore = h.reads.filter(isPage).length;
  f.click({ tagName: 'BUTTON', dataset: { action: 'sellManyRun' } });
  await until(() => store.get().sellMany?.status === 'done', 'the run');
  assert.equal(door.sent('/data/account/exchange').length, 1, 'one signature');
  await settle();
  assert.match(f.html(), /Sold · ord-0042 · filled/);
  assert.match(f.html(), /Sell many: 1 of 1 sale went through/);
  assert.ok(h.reads.filter(isPage).slice(pagesBefore).includes('/data/account?fresh=1'), 'the page read again');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sellManyClose' } });
  assert.equal(store.get().sellMany, null);
  store.timers.clear();
});

test("Sell many's DEX leg reads the Account again after the wallet answers", async () => {
  const f = fakeWindow({ hash: '#/account/portfolio', storage: memoryStorage() });
  const provider = fakeProvider({ flags: { isMetaMask: true } });
  f.win.ethereum = provider;
  const tx = { chainId: 8453, chainIdHex: '0x2105', from: WALLET_ADDRESS, to: '0x' + '34'.repeat(20), data: '0xabcd', value: '0x0', what: 'swap' };
  let placed = false, reported = null;
  const dexOf = base => ({ ...base, id: 'ord-0031', clientId: 'c0ffee00c0ffee01', venue: 'dex', venueName: 'Uniswap', status: 'pending', ref: undefined, walletTxs: [tx], ...(reported ? { ref: reported, status: 'open' } : {}) });
  const door = ownerDoor({ exchange: action => (action?.type === 'liveOrder'
    ? (placed = true, { ok: true, kind: 'order', order: dexOf(door.page().orders.find(o => o.id === 'ord-0009')) })
    : { ok: true, kind: 'result', result: { ok: true } }) });
  const page = () => {
    const p = door.page();
    return placed ? { ...p, orders: [dexOf(p.orders.find(o => o.id === 'ord-0009')), ...p.orders] } : p;
  };
  let readsAtReport = null;
  const post = async (path, body) => {
    if (path === '/data/account/live/order-sent') { door.posts.push([path, body]); reported = body.hash; readsAtReport = h.reads.length; return { status: 200, body: { ok: true } }; }
    return door.post(path, body);
  };
  const sellable = { ok: true, items: [
    { key: 'crypto:WETH', asset: 'WETH', venue: 'dex', venueName: 'Uniswap', action: 'sell', symbol: 'WETH/USDC', held: 0.35, sellQty: 0.35, ready: true },
  ], missing: [] };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': page, '/data/account/sellable': () => sellable } });
  const store = bootOwner(f, h, door, fakeMarkets(), { ownerPost: post });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSellMany' } });
  await until(() => store.get().sellMany?.status === 'picking', 'what can be sold');
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', name: 'pick', value: '0', checked: true, dataset: { action: 'sellManyPick' } } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'sellManyReview' } });
  await until(() => store.get().sellMany?.legs?.[0]?.state === 'ready', 'the leg prepared');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sellManyRun' } });
  await until(() => store.get().sellMany?.status === 'done', 'the run');
  assert.equal(store.get().sellMany.said, 'Sell many: 0 of 1 sale went through, 1 waiting for your wallet');
  await until(() => door.sent('/data/account/live/order-sent').length === 1, 'the report');
  assert.equal(provider.count('eth_sendTransaction'), 1, 'the swap sent once');
  await until(() => store.get().trade.said !== null, 'the wallet\'s words said');
  assert.equal(store.get().trade.said, 'MetaMask sent it: 0xaaaaaa…aaa1');
  await until(() => h.reads.slice(readsAtReport).includes('/data/account?fresh=1'), 'the Account read again after the wallet answered');
  store.timers.clear();
});

// the list's search box (plan 2 of the dsh UI port, Task 3): its key, its Escape, and a list refresh while it is in use
const searchBox = f => {
  const cq = f.withId('cq', { tagName: 'INPUT', type: 'search', dataset: { action: 'convQuery' }, presentIf: /id="cq"/ });
  cq.blur = () => { if (f.doc.activeElement === cq) f.doc.activeElement = f.body; };
  return cq;
};
const titled = (id, title, over = {}) => row(id, { projections: { values: { title } }, ...over });
const keyK = (mods, onPrevent = () => {}) => ({ key: 'k', code: 'KeyK', altKey: true, metaKey: false, ctrlKey: false, ...mods, preventDefault: onPrevent });

test('⌥⌘K focuses the box from the composer', async () => {
  const f = fakeWindow({ hash: '' });
  f.win.navigator = { platform: 'MacIntel' };
  const cq = searchBox(f);
  const say = f.withId('say', { tagName: 'TEXTAREA' });
  const h = host({ rows: [row('s1')] });
  started(f, h);
  await h.ready();
  assert.match(f.html(), /<kbd class="conv-search-key">⌥⌘K<\/kbd>/, 'the hint names the Mac key');
  say.focus();
  f.fire('doc', 'keydown', keyK({ ctrlKey: true }));
  assert.equal(f.doc.activeElement, say, 'Ctrl+Alt+K is not the key on a Mac');
  f.fire('doc', 'keydown', { ...keyK({ metaKey: true }), code: 'KeyJ' });
  assert.equal(f.doc.activeElement, say, 'matched on the code, K only');
  let prevented = false;
  // ⌥ turns the key into another character on a Mac: the code is what is matched, never the key
  f.fire('doc', 'keydown', { ...keyK({ metaKey: true }, () => { prevented = true; }), key: '˚' });
  assert.equal(f.doc.activeElement, cq);
  assert.ok(prevented, "the browser's own ⌥⌘K is not run");

  // off a Mac: Ctrl+Alt+K, and from a screen with no list it goes to Messages and focuses the box there
  const g = fakeWindow({ hash: '#/discover' });
  const cq2 = searchBox(g);
  const h2 = host({ rows: [row('s1')] });
  const store = started(g, h2);
  await h2.ready();
  g.fire('doc', 'keydown', keyK({ metaKey: true }));
  await settle();
  assert.equal(store.get().route.screen, 'discover', '⌥⌘K is not the key off a Mac');
  g.fire('doc', 'keydown', keyK({ ctrlKey: true }));
  await settle();
  assert.equal(store.get().route.screen, 'messages');
  assert.match(g.html(), /<kbd class="conv-search-key">Ctrl\+Alt\+K<\/kbd>/);
  assert.equal(g.doc.activeElement, cq2);
});

test('Esc clears the query, then a second Esc leaves the box, before any drawer closes', async () => {
  const f = fakeWindow({ hash: '' });
  const cq = searchBox(f);
  const h = host({ rows: [titled('s1', 'Moutai'), titled('s2', 'Other', { updatedAt: 3 })] });
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSettings' } });
  assert.equal(store.get().settingsOpen, true);
  cq.focus();
  cq.value = 'mou';
  f.fire('root', 'input', { target: cq });
  assert.equal(store.get().search.query, 'mou');
  assert.match(f.html(), /class="conv-results"[\s\S]*data-id="s1"/);
  assert.doesNotMatch(f.html(), /data-id="s2"/);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().search.query, '', 'the first Esc clears the query');
  assert.equal(cq.value, '', 'and the box');
  assert.match(f.html(), /class="rail-rows"[\s\S]*data-id="s2"/, 'the groups are back');
  assert.equal(f.doc.activeElement, cq, 'the box keeps focus');
  assert.equal(store.get().settingsOpen, true, 'Settings is still open');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.notEqual(f.doc.activeElement, cq, 'the second Esc leaves the box');
  assert.equal(store.get().settingsOpen, true, 'Settings is still open');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().settingsOpen, false, "then today's chain");
});

test('a list refresh mid-search keeps the query, the results, the focus and the caret', async () => {
  const f = fakeWindow({ hash: '' });
  const cq = searchBox(f);
  const h = host({ rows: [titled('s1', '贵州茅台'), titled('s2', 'Other', { updatedAt: 3 })] });
  const store = started(f, h);
  await h.ready();
  cq.focus();
  cq.value = '茅台';
  cq.setSelectionRange(1, 1);
  f.fire('root', 'input', { target: cq });
  assert.match(f.html(), /conv-results-count">1 conversation</);
  const lists = () => h.calls.filter(c => c[0] === 'session/list').length;
  const before = lists();
  const writes = f.writes;
  h.rows.push(titled('s3', '茅台 again', { updatedAt: 50 }));
  await store.live.refresh();
  await settle();
  assert.ok(lists() > before && f.writes > writes, 'the list was read again and drawn');
  assert.equal(store.get().search.query, '茅台');
  assert.equal(cq.value, '茅台');
  assert.equal(f.doc.activeElement, cq);
  assert.deepEqual([cq.selectionStart, cq.selectionEnd], [1, 1]);
  assert.match(f.html(), /conv-results-count">2 conversations</, 'the results follow the new list');
  assert.doesNotMatch(f.html(), /class="rail-rows"/);
});

test('Esc while an IME composes in the box dismisses the candidate: the query and the store stay as they were', async () => {
  const f = fakeWindow({ hash: '' });
  f.win.navigator = { platform: 'MacIntel' };
  const cq = searchBox(f);
  const h = host({ rows: [titled('s1', '贵州茅台')] });
  const store = started(f, h);
  await h.ready();
  cq.focus();
  cq.value = '茅';
  f.fire('root', 'input', { target: cq });
  const before = store.get();
  for (const ev of [{ key: 'Escape', isComposing: true }, { key: 'Escape', keyCode: 229 }]) {
    f.fire('doc', 'keydown', ev);
    assert.equal(store.get(), before, 'the store is untouched');
    assert.equal(cq.value, '茅', 'the box keeps its words');
    assert.equal(f.doc.activeElement, cq, 'and its focus');
  }
  // ⌥⌘K inside a composition is the composition's too
  const say = f.withId('say', { tagName: 'TEXTAREA' });
  say.focus();
  f.fire('doc', 'keydown', keyK({ metaKey: true, isComposing: true }));
  assert.equal(f.doc.activeElement, say);
});

test('pressing the pin key pins and does not open the conversation', async () => {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows: [row('s1', { updatedAt: 9 }), row('s2', { updatedAt: 5 })] });
  const store = started(f, h);
  await h.ready();
  const before = store.get().route;
  h.calls.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'pin', conv: 's2' } });
  await settle();
  assert.ok(h.calls.some(([e, a]) => e === 'workspace/pinSession' && a.request.sessionId === 's2'));
  assert.deepEqual(store.get().route, before, 'the route did not move');
  assert.deepEqual(store.get().pinned, ['s2']);
  store.timers.clear();
});

// the final review's fixes (plan 2 of the dsh UI port): the scroll boxes a query hides or redraws, the pin key's focus, ⌥⌘K's edges
test('the rows keep their scroll for when a query clears; the results keep theirs across a render while the query stands', async () => {
  const f = fakeWindow({ hash: '' });
  const cq = searchBox(f);
  const rows = f.withSelector('.rail-rows', { presentIf: /class="rail-rows"/ });
  const hits = f.withSelector('.conv-results', { presentIf: /class="conv-results"/ });
  const h = host({ rows: [titled('s1', 'Moutai'), titled('s2', 'Moutai two', { updatedAt: 3 })] });
  const store = started(f, h);
  await h.ready();
  rows.scrollTop = 120;
  cq.focus();
  cq.value = 'mou';
  f.fire('root', 'input', { target: cq });
  assert.doesNotMatch(f.html(), /class="rail-rows"/);
  hits.scrollTop = 80;
  await store.live.refresh();
  await settle();
  assert.match(f.html(), /class="conv-results"/);
  assert.equal(hits.scrollTop, 80, 'a render while the results are up leaves them where they were');
  cq.value = 'mout';
  f.fire('root', 'input', { target: cq });
  assert.equal(hits.scrollTop, 0, 'a new query starts its results at the top');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().search.query, '');
  assert.match(f.html(), /class="rail-rows"/);
  assert.equal(rows.scrollTop, 120, 'the groups come back where they stood');
  store.timers.clear();
});

test('focus stays on the row\'s pin key and on Details\' Pin key through pin and unpin', async () => {
  const f = fakeWindow({ hash: '' });
  const say = f.withId('say', { tagName: 'TEXTAREA' });
  const key = f.withId('pin-s2', { tagName: 'BUTTON', dataset: { action: 'pin', conv: 's2' }, presentIf: /id="pin-s2"/ });
  const h = host({ rows: [row('s1', { updatedAt: 9 }), row('s2', { updatedAt: 5 })] });
  const store = started(f, h);
  await h.ready();
  key.focus();
  f.click(key);
  await settle();
  assert.deepEqual(store.get().pinned, ['s2']);
  assert.match(f.html(), /data-action="unpin" data-conv="s2"[^>]*id="pin-s2"/);
  assert.equal(f.doc.activeElement, key, 'the row key keeps focus as it turns to Unpin');
  key.dataset = { action: 'unpin', conv: 's2' };
  f.click(key);
  await settle();
  assert.deepEqual(store.get().pinned, []);
  assert.equal(f.doc.activeElement, key, 'and back to Pin');
  assert.notEqual(f.doc.activeElement, say);

  const dkey = f.withId('details-pin-s1', { tagName: 'BUTTON', dataset: { action: 'pin', conv: 's1' }, presentIf: /id="details-pin-s1"/ });
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
  dkey.focus();
  f.click(dkey);
  await settle();
  assert.deepEqual(store.get().pinned, ['s1']);
  assert.match(f.html(), /data-action="unpin" data-conv="s1" id="details-pin-s1"/);
  assert.equal(f.doc.activeElement, dkey, "Details' key keeps focus as it turns to Unpin");
  store.timers.clear();
});

test('⌥⌘K with Details open on a medium window closes Details first, then focuses the box; on a wide one Details stays', async () => {
  for (const medium of [true, false]) {
    const f = fakeWindow({ hash: '' });
    f.win.navigator = { platform: 'MacIntel' };
    f.win.matchMedia = q => ({ matches: medium && q === '(min-width: 861px) and (max-width: 1399px)' });
    const cq = searchBox(f);
    const h = host({ rows: [row('s1')] });
    const store = started(f, h);
    await h.ready();
    f.click({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
    assert.equal(store.get().detailsOpen, true);
    f.fire('doc', 'keydown', keyK({ metaKey: true }));
    assert.equal(store.get().detailsOpen, !medium, medium ? 'Details closed so the list shows' : 'Details stays open beside the list');
    assert.equal(f.doc.activeElement, cq);
    store.timers.clear();
  }
});

test('⌥⇧⌘K is not the search key', async () => {
  const f = fakeWindow({ hash: '' });
  f.win.navigator = { platform: 'MacIntel' };
  searchBox(f);
  const say = f.withId('say', { tagName: 'TEXTAREA' });
  const h = host({ rows: [row('s1')] });
  started(f, h);
  await h.ready();
  say.focus();
  f.fire('doc', 'keydown', keyK({ metaKey: true, shiftKey: true }));
  assert.equal(f.doc.activeElement, say);
});

// ---- the composer's drafts in the page (plan 3 task 5): the editor is host.editor; here a recording valueEditor ----
const bot = { kind: 'bot', id: 'buffett', label: 'Buffett Type' };
const fileChip = { kind: 'file', path: 'strategies/x.md', dir: false, label: 'x.md' };
function recording() {
  const writes = [];
  return { writes, editor: { ...valueEditor, write(el, runs, at) { writes.push([el, runs, at]); valueEditor.write(el, runs, at); } } };
}
const bootComposer = async (f, h, editor) => {
  const store = boot(f.win, { editor, openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown });
  await h.ready();
  return store;
};
const type = (f, say, words, chips) => { say.value = words; if (chips) say.chips = chips; f.fire('root', 'input', { target: say }); };
const enter = (f, say, more = {}) => { let prevented = false; f.fire('doc', 'keydown', { key: 'Enter', target: say, preventDefault() { prevented = true; }, ...more }); return prevented; };
const promptsOf = h => h.calls.filter(c => c[0] === 'session/prompt').map(c => [c[1].request.sessionId, c[1].request.content[0].text]);

test('a stream frame mid-typing keeps the words, the chip and the caret', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1')] });
  const { writes, editor } = recording();
  const store = await bootComposer(f, h, editor);
  const typedAt = f.writes;
  say.focus();
  type(f, say, 'look at ETH', [bot]);
  say.setSelectionRange(7, 7);
  assert.equal(f.writes, typedAt, 'a keystroke never renders the page');
  store.dispatch('toggleRail');   // a host event's render
  assert.equal(f.writes, typedAt + 1);
  const [el, runs, at] = writes.at(-1);
  assert.equal(el, say);
  assert.deepEqual(runs, [{ type: 'text', text: 'look at ETH' }, { type: 'chip', chip: bot }]);
  assert.equal(at, 7);
  assert.equal(f.doc.activeElement, say);
  assert.equal(say.selectionStart, 7);
  store.timers.clear();
});

test('nothing renders while an IME composes; compositionend takes the words, then renders', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1')] });
  const { writes, editor } = recording();
  const store = await bootComposer(f, h, editor);
  const before = f.writes;
  say.focus();
  f.fire('root', 'compositionstart', { target: say });
  store.dispatch('toggleRail');
  say.value = '你好';
  f.fire('root', 'input', { target: say, isComposing: true });
  assert.equal(f.writes, before, 'held while composing');
  f.fire('root', 'compositionend', { target: say });
  assert.equal(f.writes, before + 1);
  assert.deepEqual(writes.at(-1)[1], [{ type: 'text', text: '你好' }]);
  assert.equal(say.value, '你好');
  store.timers.clear();
});

test('Enter sends; Shift+Enter does not; Enter during a composition (isComposing, or keyCode 229) does not', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootComposer(f, h, valueEditor);
  say.focus();
  type(f, say, 'line one');
  assert.equal(enter(f, say, { shiftKey: true }), false, 'Shift+Enter is the browser\'s own new line');
  assert.equal(enter(f, say, { isComposing: true }), false);
  assert.equal(enter(f, say, { keyCode: 229 }), false);
  await settle();
  assert.deepEqual(promptsOf(h), [], 'nothing sent');
  assert.equal(enter(f, say), true);
  await settle();
  assert.deepEqual(promptsOf(h), [['s1', 'line one']]);
  assert.equal(say.value, '');
  assert.equal(enter(f, say), true, 'Enter on a blank draft is still the composer\'s');
  await settle();
  assert.equal(promptsOf(h).length, 1, 'a blank draft sends nothing');
  store.timers.clear();
});

test('each conversation keeps its own draft, and sending in one leaves the other\'s', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { updatedAt: 50, agentAvailable: true }), row('s2', { updatedAt: 9, agentAvailable: true })] });
  const store = await bootComposer(f, h, valueEditor);
  type(f, say, 'for A');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  assert.equal(say.value, '', 'B starts empty');
  type(f, say, 'for B');
  send(f);
  await settle();
  assert.deepEqual(promptsOf(h), [['s2', 'for B']]);
  assert.equal(say.value, '');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.equal(say.value, 'for A', 'A kept its words');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  assert.equal(say.value, '', 'B was sent and cleared');
  store.timers.clear();
});

test('a failed send keeps the whole draft, chips included, under its own conversation', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { updatedAt: 50, agentAvailable: true }), row('s2', { updatedAt: 9 })] });
  const call = h.call;
  h.call = async (endpoint, args) => { if (endpoint === 'session/prompt') { h.calls.push([endpoint, args]); throw new Error('host down'); } return call(endpoint, args); };
  const { writes, editor } = recording();
  const store = await bootComposer(f, h, editor);
  type(f, say, 'ask ', [fileChip]);
  send(f);
  await settle();
  assert.deepEqual(promptsOf(h), [['s1', 'ask @strategies/x.md']], 'the chip serialized');
  const draft = [{ type: 'text', text: 'ask ' }, { type: 'chip', chip: fileChip }];
  assert.deepEqual(writes.at(-1)[1], draft, 'back in the editor');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  assert.deepEqual(writes.at(-1)[1], [], 'not in another conversation');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.deepEqual(writes.at(-1)[1], draft, 'under its own');
  store.timers.clear();
});

test('New message keeps its draft under new, and a created conversation clears it', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootComposer(f, h, valueEditor);
  type(f, say, 'in s1');
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  assert.equal(say.value, '', 'New message has its own draft');
  type(f, say, 'a new thought');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.equal(say.value, 'in s1');
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  assert.equal(say.value, 'a new thought', 'kept under new');
  send(f);
  await settle();
  assert.equal(store.get().route.id, 's-new');
  assert.deepEqual(promptsOf(h), [['s-new', 'a new thought']]);
  assert.equal(say.value, '');
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  assert.equal(say.value, '', 'the created conversation took it');
  store.timers.clear();
});

test('a paste arrives as plain text at the caret', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootComposer(f, h, valueEditor);
  say.focus();
  type(f, say, 'ab');
  say.setSelectionRange(1, 1);
  const before = f.writes;
  let prevented = false;
  f.fire('root', 'paste', { target: say, preventDefault() { prevented = true; }, clipboardData: { getData: t => (t === 'text/plain' ? 'X\r\nY' : '<b>X</b>') } });
  assert.equal(prevented, true);
  assert.equal(f.writes, before, 'the page is not rendered');
  assert.equal(say.value, 'aX\nYb');
  assert.equal(say.selectionStart, 4, 'the caret after the pasted text');
  send(f);
  await settle();
  assert.deepEqual(promptsOf(h), [['s1', 'aX\nYb']]);
  store.timers.clear();
});

// ---- fix round 1 of task 5 ----
test('a paste over a selection replaces it, the caret after the pasted text', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootComposer(f, h, valueEditor);
  say.focus();
  type(f, say, 'abcd');
  say.setSelectionRange(1, 3);
  f.fire('root', 'paste', { target: say, clipboardData: { getData: t => (t === 'text/plain' ? 'XY' : '') } });
  assert.equal(say.value, 'aXYd');
  assert.deepEqual([say.selectionStart, say.selectionEnd], [3, 3]);
  store.timers.clear();
});

test('a send that fails after more was typed loses nothing: the sent words, a new line, then the new ones', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const call = h.call;
  let fail;
  h.call = (endpoint, args) => (endpoint === 'session/prompt' ? new Promise((_, reject) => { fail = () => reject(new Error('host down')); }) : call(endpoint, args));
  const store = await bootComposer(f, h, valueEditor);
  type(f, say, 'first thought');
  send(f);
  await settle();
  assert.equal(say.value, '', 'cleared while it is on its way');
  type(f, say, 'second');
  fail();
  await settle();
  assert.equal(say.value, 'first thought\nsecond');
  store.timers.clear();
});

test('a render keeps a selection in the editor, and a new draft on screen puts the caret at its end', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { updatedAt: 50 }), row('s2', { updatedAt: 9 })] });
  const { writes, editor } = recording();
  const store = await bootComposer(f, h, editor);
  say.focus();
  type(f, say, 'hello world');
  say.setSelectionRange(2, 5);
  store.dispatch('toggleRail');
  assert.deepEqual([say.selectionStart, say.selectionEnd], [2, 5], 'the selection is kept');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  type(f, say, 'abc');
  say.focus();
  say.setSelectionRange(0, 0);
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.equal(say.value, 'hello world');
  assert.equal(f.doc.activeElement, say);
  assert.deepEqual([say.selectionStart, say.selectionEnd], [11, 11], 'at the end of the draft now on screen');
  assert.equal(writes.length > 0, true);
  store.timers.clear();
});

test('typing in a node inside the editor is the editor\'s typing', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootComposer(f, h, valueEditor);
  say.value = 'from a line block';
  f.fire('root', 'input', { target: { tagName: 'DIV', dataset: {}, closest: sel => (sel === '#say' ? say : null) } });
  send(f);
  await settle();
  assert.deepEqual(promptsOf(h), [['s1', 'from a line block']]);
  store.timers.clear();
});

test('a suggestion joins a draft already written, on a new line, rather than replacing it', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1')] });
  const store = await bootComposer(f, h, valueEditor);
  type(f, say, 'mine');
  f.click({ tagName: 'BUTTON', dataset: { action: 'suggest', text: 'Look at BTC' } });
  assert.equal(say.value, 'mine\nLook at BTC');
  assert.equal(say.selectionStart, 'mine\nLook at BTC'.length);
  store.timers.clear();
});

// ---- the composer's menus in the page (plan 3 task 7): open, filter, move, choose, close ----
// an editor over a fake element that keeps the runs written to it (chips and all); typing sets its words afresh
const runsEditor = {
  read: el => el.runs ?? (el.value ? [{ type: 'text', text: el.value }] : []),
  caret: el => el.selectionStart,
  selection: el => [el.selectionStart, el.selectionEnd],
  place: (el, at, end) => el.setSelectionRange(at, end ?? at),
  write(el, runs, at, end) {
    el.runs = runs;
    el.value = runs.map(r => (r.type === 'text' ? r.text : r.chip.label)).join('');
    if (at != null) el.setSelectionRange(at, end ?? at);
  },
};
const typeMenu = (f, say, words) => { say.runs = null; say.value = words; say.setSelectionRange(words.length, words.length); f.fire('root', 'input', { target: say }); };
const press = (f, say, key, more = {}) => { let prevented = false; f.fire('doc', 'keydown', { key, target: say, preventDefault() { prevented = true; }, ...more }); return prevented; };
const CMDS = [{ name: 'compact', description: 'Compact the conversation' }, { name: 'review', description: 'Review a change', input: { hint: 'what to review' } }];
const SKILLS = [{ name: 'lunhui', description: 'An A-share run', modelInvocable: true }];
const FILES = [{ path: 'strategies/x.md', kind: 'file' }, { path: 'strategies', kind: 'directory' }];
// the test host with a root at /r, s1 in the channel alpha (/r/strategies/alpha), and the menus' reads answered
function menuHost({ rows, files, roster = [] } = {}) {
  const h = host({ rows: rows ?? [titled('s1', 'Alpha', { updatedAt: 50, agentAvailable: true }), titled('s2', 'Beta', { updatedAt: 9 })] });
  h.inventory['/data/bots.json'].bots[0].description = 'A value investor';
  const call = h.call, getJson = h.getJson, postJson = h.postJson;
  h.call = async (endpoint, args) => {
    if (endpoint === 'commands/list') { h.calls.push([endpoint, args]); return CMDS; }
    if (endpoint === 'skills/list') { h.calls.push([endpoint, args]); return { skills: SKILLS }; }
    return call(endpoint, args);
  };
  h.getJson = async path => {
    if (path === '/data/channels.json') {
      const body = await getJson(path);
      return { ...body, channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true, dir: '/r', sessionIds: [] }, { workspaceId: 'w1', name: 'alpha', isRoot: false, dir: '/r/strategies/alpha', sessionIds: ['s1'] }] };
    }
    if (path.startsWith('/data/files?')) { h.reads.push(path); return files ? files(path) : { ok: true, items: FILES, truncated: false }; }
    return getJson(path);
  };
  h.postJson = async (path, body) => (path === '/data/rooms/state' ? (h.posted.push([path, body]), { roster, members: [], caps: {} }) : postJson(path, body));
  return h;
}
const menuRig = async (opts = {}) => {
  const f = fakeWindow({ hash: opts.hash ?? '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const slot = f.withId('composer-menu');
  const h = menuHost(opts);
  opts.wrap?.(h);   // a test's own answers, in place before the boot takes the host's functions
  const store = await bootComposer(f, h, runsEditor);
  say.focus();
  return { f, say, slot, h, store };
};
const activeOf = slot => /class="cmenu-row active"[^>]*id="(cm-\d+)"/.exec(slot.innerHTML)?.[1] ?? null;

test('typing / on a live conversation opens the menu with no page render, and each letter redraws only the menu', async () => {
  const { f, say, slot, h, store } = await menuRig();
  const before = f.writes;
  typeMenu(f, say, '/');
  await settle();
  assert.equal(f.writes, before, 'no page render');
  assert.match(slot.innerHTML, /Compact/);
  assert.match(slot.innerHTML, /cmenu-group">Commands</);
  assert.match(slot.innerHTML, /cmenu-group">Skills</);
  assert.equal(say.attributes['aria-expanded'], 'true');
  assert.equal(say.attributes['aria-activedescendant'], 'cm-0');
  assert.ok(h.calls.some(c => c[0] === 'commands/list' && c[1].agentId === 's1'));
  assert.ok(h.calls.some(c => c[0] === 'skills/list' && c[1].request.sessionId === 's1'));
  typeMenu(f, say, '/lu');
  assert.equal(f.writes, before);
  assert.match(slot.innerHTML, /lunhui/, 'drawn at once from the rows kept');
  assert.doesNotMatch(slot.innerHTML, /Compact/);
  store.dispatch('toggleRail');   // a full render draws the menu in the page's own markup
  assert.match(f.html(), /id="composer-menu"><div class="cmenu"[^]*lunhui/);
  store.timers.clear();
});

test('/ on New message opens nothing; @ there lists files and conversations', async () => {
  const { f, say, slot, h, store } = await menuRig();
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  say.focus();
  typeMenu(f, say, '/');
  await settle();
  assert.equal(slot.innerHTML ?? '', '');
  assert.equal(h.calls.some(c => c[0] === 'commands/list' || c[0] === 'skills/list'), false, 'nothing read');
  typeMenu(f, say, '@');
  await settle();
  assert.match(slot.innerHTML, /cmenu-group">Files and folders</);
  assert.match(slot.innerHTML, /cmenu-group">Conversations</);
  assert.doesNotMatch(slot.innerHTML, /Bots in this room/);
  assert.ok(h.reads.includes('/data/files?q='), 'New message in the root channel reads the root');
  store.timers.clear();
});

test('↑ ↓ move and wrap, Enter chooses, Tab chooses, Esc closes and keeps the draft, Shift+Tab closes', async () => {
  const { f, say, slot, h, store } = await menuRig();
  typeMenu(f, say, '@');
  await settle();
  // x.md, strategies/, Beta
  assert.equal(activeOf(slot), 'cm-0');
  assert.equal(press(f, say, 'ArrowDown'), true);
  assert.equal(activeOf(slot), 'cm-1');
  press(f, say, 'ArrowUp'); press(f, say, 'ArrowUp');
  assert.equal(activeOf(slot), 'cm-2', 'wraps');
  assert.equal(say.attributes['aria-activedescendant'], 'cm-2');
  assert.equal(press(f, say, 'Enter'), true);
  await settle();
  assert.deepEqual(say.runs, [{ type: 'chip', chip: { kind: 'conversation', id: 's2', label: 'Beta' } }, { type: 'text', text: ' ' }]);
  assert.equal(slot.innerHTML, '');
  assert.equal(say.attributes['aria-expanded'], 'false');
  assert.deepEqual(promptsOf(h), [], 'Enter chose, it did not send');

  typeMenu(f, say, '@');
  await settle();
  assert.equal(press(f, say, 'Tab'), true);
  assert.deepEqual(say.runs, [{ type: 'chip', chip: { kind: 'file', path: 'strategies/x.md', dir: false, label: 'x.md' } }, { type: 'text', text: ' ' }]);

  typeMenu(f, say, 'hm @');
  await settle();
  assert.equal(press(f, say, 'Escape'), true);
  assert.equal(slot.innerHTML, '');
  assert.equal(say.value, 'hm @', 'the draft is kept');
  typeMenu(f, say, 'hm @');
  await settle();
  assert.equal(slot.innerHTML, '', 'the same trigger stays dismissed');
  typeMenu(f, say, 'hm @s');
  await settle();
  assert.notEqual(slot.innerHTML, '', 'a new letter opens it again');
  assert.equal(press(f, say, 'Tab', { shiftKey: true }), true);
  assert.equal(slot.innerHTML, '');
  assert.equal(say.value, 'hm @s');
  store.timers.clear();
});

test('Esc with a menu open closes the menu, not Details', async () => {
  const { f, say, slot, store } = await menuRig();
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
  assert.equal(store.get().detailsOpen, true);
  say.focus();
  typeMenu(f, say, '@');
  await settle();
  assert.notEqual(slot.innerHTML, '');
  press(f, say, 'Escape');
  assert.equal(slot.innerHTML, '');
  assert.equal(store.get().detailsOpen, true, 'Details stays open');
  press(f, say, 'Escape');
  assert.equal(store.get().detailsOpen, false, 'the next Esc is today\'s chain');
  store.timers.clear();
});

test('Enter with a trigger whose menu has no rows sends the draft', async () => {
  const { f, say, slot, h, store } = await menuRig();
  typeMenu(f, say, 'look /zzz');
  await settle();
  assert.equal(slot.innerHTML ?? '', '');
  assert.equal(press(f, say, 'Enter'), true);
  await settle();
  assert.deepEqual(promptsOf(h), [['s1', 'look /zzz']]);
  store.timers.clear();
});

test('choosing a skill or an argument command puts /name and a space in the draft', async () => {
  const { f, say, slot, store } = await menuRig();
  typeMenu(f, say, '/');
  await settle();
  // Compact, Review, lunhui
  press(f, say, 'ArrowDown');
  press(f, say, 'Enter');
  assert.equal(say.value, '/review ');
  assert.equal(say.selectionStart, 8);
  assert.equal(slot.innerHTML, '');
  typeMenu(f, say, '/lun');
  await settle();
  press(f, say, 'Tab');
  assert.equal(say.value, '/lunhui ');
  assert.equal(say.selectionStart, 8);
  store.timers.clear();
});

test('choosing a file, a folder, a bot or a conversation puts its chip and a space, the caret after them', async () => {
  const { f, say, slot, h, store } = await menuRig({ roster: [{ id: 'buffett', name: 'Buffett Type' }] });
  const chips = [
    { kind: 'bot', id: 'buffett', label: 'Buffett Type' },
    { kind: 'file', path: 'strategies/x.md', dir: false, label: 'x.md' },
    { kind: 'file', path: 'strategies', dir: true, label: 'strategies/' },
    { kind: 'conversation', id: 's2', label: 'Beta' },
  ];
  for (const [i, chip] of chips.entries()) {
    typeMenu(f, say, 'see @');
    await settle();
    if (i === 0) {
      assert.match(slot.innerHTML, /cmenu-group">Bots in this room</);
      assert.match(slot.innerHTML, /A value investor/, 'the bot\'s line from the bots list');
      assert.ok(h.posted.some(p => p[0] === '/data/rooms/state' && p[1].sessionId === 's1'));
      assert.ok(h.reads.includes('/data/files?q=&dir=strategies%2Falpha'), 'files read from the channel\'s folder');
    }
    for (let k = 0; k < i; k++) press(f, say, 'ArrowDown');
    press(f, say, 'Enter');
    assert.deepEqual(say.runs, [{ type: 'text', text: 'see ' }, { type: 'chip', chip }, { type: 'text', text: ' ' }]);
    assert.equal(say.selectionStart, 6);
    assert.equal(slot.innerHTML, '');
  }
  store.timers.clear();
});

test('Tab on a folder walks into it and shows its crumb', async () => {
  const { f, say, slot, h, store } = await menuRig();
  typeMenu(f, say, '@');
  await settle();
  press(f, say, 'ArrowDown');
  assert.equal(press(f, say, 'Tab'), true);
  assert.equal(say.value, '@strategies/');
  assert.equal(say.selectionStart, 12);
  await settle();
  assert.ok(h.reads.includes('/data/files?q=strategies%2F&dir=strategies%2Falpha'));
  assert.match(slot.innerHTML, /cmenu-crumb">strategies\/</);
  store.timers.clear();
});

test('a files answer for an older query, or after Esc, draws nothing', async () => {
  const waiting = [];
  const files = path => new Promise(resolve => waiting.push({ path, resolve }));
  const { f, say, slot, store } = await menuRig({ files, rows: [titled('s1', 'Alpha', { updatedAt: 50, agentAvailable: true }), titled('s2', 'Stocks', { updatedAt: 9 })] });
  typeMenu(f, say, '@stra');
  typeMenu(f, say, '@strategies/');
  await settle();
  const [older, newer] = waiting;
  newer.resolve({ ok: true, items: [{ path: 'strategies/new.md', kind: 'file' }], truncated: false });
  await settle();
  older.resolve({ ok: true, items: [{ path: 'stale.md', kind: 'file' }], truncated: false });
  await settle();
  assert.match(slot.innerHTML, /new\.md/);
  assert.doesNotMatch(slot.innerHTML, /stale\.md/);

  typeMenu(f, say, '@st');
  await settle();
  assert.match(slot.innerHTML, /Stocks/, 'the conversations draw before the files answer');
  press(f, say, 'Escape');
  waiting.at(-1).resolve({ ok: true, items: [{ path: 'late.md', kind: 'file' }], truncated: false });
  await settle();
  assert.equal(slot.innerHTML, '', 'closed by Esc stays closed');

  // Esc while the trigger stands with no rows yet: the chain runs, and the rows that land later open nothing
  typeMenu(f, say, '@zz');
  await settle();
  assert.equal(slot.innerHTML, '');
  press(f, say, 'Escape');
  waiting.at(-1).resolve({ ok: true, items: [{ path: 'zz.md', kind: 'file' }], truncated: false });
  await settle();
  assert.equal(slot.innerHTML, '');
  store.timers.clear();
});

test('a click on a row chooses it and the editor keeps focus', async () => {
  const { f, say, slot, store } = await menuRig();
  typeMenu(f, say, '@');
  await settle();
  let prevented = false;
  f.fire('root', 'pointerdown', { button: 0, target: { closest: sel => (sel === '.cmenu' ? {} : null) }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'a press in the menu keeps the editor\'s focus and caret');
  f.click({ tagName: 'DIV', dataset: { action: 'menuPick', index: '1' } });
  f.fire('doc', 'pointerup');
  assert.deepEqual(say.runs, [{ type: 'chip', chip: { kind: 'file', path: 'strategies', dir: true, label: 'strategies/' } }, { type: 'text', text: ' ' }]);
  assert.equal(f.doc.activeElement, say);
  assert.equal(slot.innerHTML, '');
  store.timers.clear();
});

test('⌥⌘K with the stock drawer open on a medium window closes it first, then focuses the box; on a wide one it stays', async () => {
  for (const medium of [true, false]) {
    const { f, store, open } = await stockAnswer();
    f.win.matchMedia = q => ({ matches: medium && q === '(min-width: 861px) and (max-width: 1399px)' });
    const cq = searchBox(f);
    open();
    assert.ok(store.get().lunhui.stock);
    f.fire('doc', 'keydown', keyK({ ctrlKey: true }));   // off a Mac (the page was booted with no navigator)
    assert.equal(store.get().lunhui.stock == null, medium, medium ? 'the stock drawer closed so the list shows' : 'the drawer stays beside the list');
    assert.equal(f.doc.activeElement, cq);
    store.timers.clear();
  }
  // both open at once (a state the reducers never make, the rule closes each)
  const { f, store, key } = await stockAnswer();
  f.win.matchMedia = q => ({ matches: q === '(min-width: 861px) and (max-width: 1399px)' });
  const cq = searchBox(f);
  const s = store.get();
  store.reset({ ...s, detailsOpen: true, lunhui: { ...s.lunhui, stock: { key, code: '600001' } } });
  f.fire('doc', 'keydown', keyK({ ctrlKey: true }));
  assert.equal(store.get().lunhui.stock, null);
  assert.equal(store.get().detailsOpen, false);
  assert.equal(f.doc.activeElement, cq);
  store.timers.clear();
});

// ---- fix round 1 of task 7 ----
test('a growing query reads commands, skills and the roster once per trigger, and files once per query', async () => {
  const { f, say, h, store } = await menuRig({ roster: [{ id: 'buffett', name: 'Buffett Type' }] });
  const count = name => h.calls.filter(c => c[0] === name).length;
  for (const words of ['/', '/c', '/co', '/com', '/compact']) { typeMenu(f, say, words); await settle(); }
  assert.equal(count('commands/list'), 1);
  assert.equal(count('skills/list'), 1);
  typeMenu(f, say, '/compact @');
  await settle();
  const filesAt = h.reads.filter(p => p.startsWith('/data/files?')).length;
  for (const words of ['/compact @s', '/compact @st', '/compact @str']) { typeMenu(f, say, words); await settle(); }
  assert.equal(h.posted.filter(p => p[0] === '/data/rooms/state').length, 1, 'the roster once for the @ trigger');
  assert.equal(h.reads.filter(p => p.startsWith('/data/files?')).length, filesAt + 3, 'files once per query');
  store.timers.clear();
});

test('a skills answer that lands after the query grew still draws, filtered by the query now', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const say = f.withId('say', { tagName: 'INPUT' });
  const slot = f.withId('composer-menu');
  const h = menuHost();
  const call = h.call;
  let release;
  h.call = async (endpoint, args) => (endpoint === 'skills/list' ? new Promise(r => { release = () => r({ skills: [...SKILLS, { name: 'luck', description: 'x' }] }); }) : call(endpoint, args));
  const store = await bootComposer(f, h, runsEditor);
  say.focus();
  typeMenu(f, say, '/');
  await settle();
  typeMenu(f, say, '/lunh');
  await settle();
  assert.doesNotMatch(slot.innerHTML ?? '', /lunhui/);
  release();
  await settle();
  assert.match(slot.innerHTML, /lunhui/);
  assert.doesNotMatch(slot.innerHTML, /luck/, 'filtered by the query as it reads now');
  store.timers.clear();
});

test('the menu closes when the editor loses focus, but not to the menu itself or a render that gives focus back', async () => {
  const { f, say, slot, store } = await menuRig();
  typeMenu(f, say, '@');
  await settle();
  assert.notEqual(slot.innerHTML, '');
  // a render gives the editor its focus back: the menu stays
  f.fire('root', 'focusout', { target: say, relatedTarget: null });
  say.focus();
  await settle();
  assert.notEqual(slot.innerHTML, '', 'focus came back to the editor');
  // a press moving focus into the menu
  const inMenu = { closest: sel => (sel === '.cmenu' ? {} : null) };
  f.fire('root', 'focusout', { target: say, relatedTarget: inMenu });
  f.doc.activeElement = inMenu;
  await settle();
  assert.notEqual(slot.innerHTML, '', 'into the menu');
  say.focus();
  // a click into the thread
  f.fire('root', 'focusout', { target: say, relatedTarget: null });
  f.doc.activeElement = f.body;
  await settle();
  assert.equal(slot.innerHTML, '');
  assert.equal(say.attributes['aria-expanded'], 'false');
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
  f.fire('doc', 'keydown', { key: 'Escape', target: f.body });
  assert.equal(store.get().detailsOpen, false, 'Esc is the drawers\' again');
  store.timers.clear();
});

// ---- plan 3 task 8: a command chosen from the menu runs; what reaches the room and what reaches Gravit ----
const putRuns = (f, say, runs) => { say.runs = runs; say.value = runs.map(r => (r.type === 'text' ? r.text : r.chip.label)).join(''); say.setSelectionRange(say.value.length, say.value.length); f.fire('root', 'input', { target: say }); };
const saysOf = h => h.posted.filter(p => p[0] === '/data/rooms/say');
const botChip = { kind: 'bot', id: 'buffett', label: 'Buffett Type' };

test('Compact from the menu runs /compact at once, and the draft keeps its other words', async () => {
  const { f, say, slot, h, store } = await menuRig({ wrap: h => {
    const call = h.call;
    h.call = async (endpoint, args) => {
      if (endpoint === 'commands/execute') { h.calls.push([endpoint, args]); return { result: { kind: 'ok', text: 'compacted' } }; }
      return call(endpoint, args);
    };
  } });
  typeMenu(f, say, 'tidy up /comp');
  await settle();
  assert.match(slot.innerHTML, /Compact/);
  assert.equal(press(f, say, 'Enter'), true);
  await settle();
  assert.deepEqual(h.calls.filter(c => c[0] === 'commands/execute'), [['commands/execute', { agentId: 's1', line: '/compact', submittedAttachments: [] }]]);
  assert.equal(say.value, 'tidy up ', 'the token is gone, the rest stays');
  assert.equal(say.selectionStart, 8);
  assert.equal(slot.innerHTML, '');
  assert.deepEqual(promptsOf(h), [], 'nothing was prompted');
  assert.equal(store.get().status.line, 'compacted');
  store.dispatch('toggleRail');
  assert.equal(say.value, 'tidy up ', 'the draft kept its words through a render');
  store.timers.clear();
});

test('a bot chip with a conversation chip is refused before sending, and the draft stays', async () => {
  const { f, say, h, store } = await menuRig();
  const draft = [{ type: 'text', text: 'ask ' }, { type: 'chip', chip: botChip }, { type: 'text', text: ' about ' }, { type: 'chip', chip: { kind: 'conversation', id: 's2', label: 'Beta' } }];
  putRuns(f, say, draft);
  send(f);
  await settle();
  assert.deepEqual(saysOf(h), []);
  assert.deepEqual(promptsOf(h), []);
  assert.equal(store.get().status.line, "Conversations go to Gravit, not to a room's bots");
  assert.equal(store.get().status.bad, true);
  store.dispatch('toggleRail');
  assert.deepEqual(say.runs, draft, 'the draft stays');
  store.timers.clear();
});

test("a bot chip with a file chip goes to the room with the bot's @id and the file's path", async () => {
  const { f, say, h, store } = await menuRig({ wrap: h => {
    const postJson = h.postJson;
    h.postJson = async (path, body) => (path === '/data/rooms/say' ? (h.posted.push([path, body]), { ok: true, addressed: ['buffett'] }) : postJson(path, body));
  } });
  putRuns(f, say, [{ type: 'text', text: 'ask ' }, { type: 'chip', chip: botChip }, { type: 'text', text: ' about ' }, { type: 'chip', chip: { kind: 'file', path: 'strategies/alpha/notes.md', dir: false, label: 'notes.md' } }]);
  send(f);
  await settle();
  assert.deepEqual(saysOf(h), [['/data/rooms/say', { sessionId: 's1', text: 'ask @buffett about @notes.md' }]]);
  assert.deepEqual(promptsOf(h), []);
  store.timers.clear();
});

test('a file chip that reads like a bot, with no bot chip, is prompted to Gravit and never posted to the room', async () => {
  const { f, say, h, store } = await menuRig();
  putRuns(f, say, [{ type: 'text', text: 'read ' }, { type: 'chip', chip: { kind: 'file', path: 'strategies/alpha/news-scout.md', dir: false, label: 'news-scout.md' } }]);
  send(f);
  await settle();
  assert.deepEqual(saysOf(h), [], 'never posted to the room on its own account');
  assert.deepEqual(promptsOf(h), [['s1', 'read @news-scout.md']]);
  store.timers.clear();
});

test('a typed @buffett with no chip still tries the room, as today', async () => {
  const { f, say, h, store } = await menuRig();
  putRuns(f, say, [{ type: 'text', text: '@buffett leverage?' }]);
  send(f);
  await settle();
  assert.deepEqual(saysOf(h), [['/data/rooms/say', { sessionId: 's1', text: '@buffett leverage?' }]]);
  assert.deepEqual(promptsOf(h), [['s1', '@buffett leverage?']], 'nobody addressed, so an ordinary prompt');
  store.timers.clear();
});
