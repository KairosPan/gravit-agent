// boot() against a fake window and a fake host: what the person sees after the list lands, opening, sending, answering.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot as bootApp, Timers, DROP_QUIET_MS } from '../../client/js/app.js';
import { rowsOf, pairsOf } from '../../client/js/host/market-view.js';
import { kidOf } from '../../client/js/wire/owner-key.js';
import { fakeWindow } from './helpers/fake-dom.js';
import { startComposerReads } from '../../client/js/host/composer.js';
import { valueEditor } from './helpers/value-editor.js';
import { modulesListing } from './helpers/inventory.js';
import { VIEW_1027 } from './helpers/lunhui-view.js';
import { fakeProvider, ADDRESS as WALLET_ADDRESS, hashOf } from './helpers/fake-wallet.js';
import { rebuildQuery } from '../../src/account-proxy.ts';

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
    if (endpoint === 'session/page') { const pg = pages[args.request.address.sessionId]; return typeof pg === 'function' ? pg(args.request) : Array.isArray(pg) || pg === undefined ? { records: pg ?? [] } : pg; }
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

// ---- the earlier key and the thread's place on a prepend (plan 5 task 4)
// an operator message at seq, its words naming the seq, so a test can tell the pages apart in the markup
const said = seq => ({ type: 'event', event: { ...frames[0].event, seq, data: { ...frames[0].event.data, id: 'msg-' + seq, content: [{ type: 'text', text: 'said ' + seq }] } } });
// a followed conversation whose snapshot is 30-31 with more before it; earlier pages by beforeSeq: 10-11 before 30 (more
// before it), 2-3 before 10 (none). The fake thread is 1000 px tall until a page lands above, then 600 px taller per page
function earlierRig() {
  const f = fakeWindow({ hash: '' });
  const thread = f.withId('thread', { clientHeight: 400 });
  Object.defineProperty(thread, 'scrollHeight', { get: () => 1000 + (f.html().includes('said 10') ? 600 : 0) + (f.html().includes('said 2') ? 600 : 0) });
  const book = { 30: { records: [said(10), said(11)], hasMore: true }, 10: { records: [said(2), said(3)], hasMore: false } };
  const h = host({ rows: [row('s1', { agentAvailable: true })], pages: { s1: req => book[req.beforeSeq] ?? { records: [], hasMore: false } } });
  return { f, thread, h };
}
const earlierPages = h => h.calls.filter(c => c[0] === 'session/page' && c[1].request.beforeSeq !== undefined).map(c => c[1].request.beforeSeq);

test('Earlier messages pages back, and the thread keeps its place as the page lands above it', async () => {
  const { f, thread, h } = earlierRig();
  const store = started(f, h);
  await h.ready();
  h.streams.find(s => s.name === 'session/follow').cbs.onItem({ type: 'snapshot', header: {}, cursor: 40, hasMore: true, records: [said(30), said(31)], projections: { asOfSeq: 40, values: {} } });
  await settle();
  assert.match(f.html(), /<button class="btn-sm earlier-key" type="button" id="earlier-s1" data-action="earlier" data-conv="s1">Earlier messages<\/button>/);
  thread.scrollTop = 0; // read up to the top, where the key is
  f.click({ tagName: 'BUTTON', dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  assert.deepEqual(earlierPages(h), [30]);
  assert.match(f.html(), /said 10/);
  assert.equal(thread.scrollTop, 600, 'the words read before the page landed stay under the reader');
  assert.match(f.html(), /data-action="earlier"[^>]*>Earlier messages</, 'more stands before it');
  store.timers.clear();
});

test("a reconnect's snapshot while reading up keeps the place and the earlier pages", async () => {
  const { f, thread, h } = earlierRig();
  const store = started(f, h);
  await h.ready();
  const snap = (cursor, seqs) => ({ type: 'snapshot', header: {}, cursor, hasMore: true, records: seqs.map(said), projections: { asOfSeq: cursor, values: {} } });
  h.streams.find(s => s.name === 'session/follow').cbs.onItem(snap(40, [30, 31]));
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  thread.scrollTop = 250; // reading the earlier page
  // the mux drops and comes back: the conversation is followed again and its new snapshot lands
  h.opts().onDown('lost');
  h.opts().onReady({});
  await settle();
  const follows = h.streams.filter(s => s.name === 'session/follow' && !s.cancelled);
  follows[follows.length - 1].cbs.onItem(snap(41, [30, 31, 32]));
  await settle();
  assert.match(f.html(), /said 10[\s\S]*said 30[\s\S]*said 32/, 'the earlier page stays above the new window');
  assert.equal(thread.scrollTop, 250, 'the thread does not jump to the tail');
  f.click({ tagName: 'BUTTON', dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  assert.deepEqual(earlierPages(h), [30, 10], 'Earlier messages pages on from where it was');
  assert.match(f.html(), /said 2[\s\S]*said 10/);
  assert.equal(thread.scrollTop, 850, 'the second page lands above the place too');
  assert.doesNotMatch(f.html(), /earlier-key/, 'nothing more before it');
  store.timers.clear();
});

test('the earlier key keeps focus while it reads and after the page, without scrolling; #say takes it after the last page', async () => {
  const f = fakeWindow({ hash: '' });
  const thread = f.withId('thread', { clientHeight: 400 });
  Object.defineProperty(thread, 'scrollHeight', { get: () => 1000 + (f.html().includes('said 10') ? 600 : 0) + (f.html().includes('said 2') ? 600 : 0) });
  const say = f.withId('say', { tagName: 'INPUT' });
  const key = f.withId('earlier-s1', { tagName: 'BUTTON', presentIf: /id="earlier-s1"/ });
  // a plain focus() brings the key at the top into view, as the browser does
  key.focus = o => { f.doc.activeElement = key; key.focusedWith = o; if (!o?.preventScroll) thread.scrollTop = 0; };
  const waits = [];
  const book = { 30: { records: [said(10), said(11)], hasMore: true }, 10: { records: [said(2), said(3)], hasMore: false } };
  const h = host({ rows: [row('s1', { agentAvailable: true })], pages: { s1: req => new Promise(r => waits.push(() => r(book[req.beforeSeq]))) } });
  const store = started(f, h);
  await h.ready();
  h.streams.find(s => s.name === 'session/follow').cbs.onItem({ type: 'snapshot', header: {}, cursor: 40, hasMore: true, records: [said(30), said(31)], projections: { asOfSeq: 40, values: {} } });
  await settle();
  thread.scrollTop = 0;
  key.focus();
  f.click({ ...key, dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  assert.match(f.html(), /id="earlier-s1"[^>]*aria-disabled="true">Loading…</);
  assert.equal(f.doc.activeElement, key, 'the key keeps focus while it reads');
  assert.equal(key.focusedWith?.preventScroll, true);
  f.click({ ...key, dataset: { action: 'earlier', conv: 's1' } }); // pressed again while it reads: nothing more asked
  await settle();
  assert.equal(earlierPages(h).length, 1);
  waits.shift()();
  await settle();
  assert.equal(f.doc.activeElement, key, 'and after the page lands');
  assert.equal(thread.scrollTop, 600, 'the focus does not scroll the key into view');
  f.click({ ...key, dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  waits.shift()();
  await settle();
  assert.doesNotMatch(f.html(), /earlier-key/);
  assert.equal(f.doc.activeElement, say, 'the last page: the key goes, the composer takes focus');
  assert.equal(thread.scrollTop, 1200);
  store.timers.clear();
});

test('a stream frame held with the page (a press down) does not shift the reader: the keep anchors on the old first message', async () => {
  const { f, thread, h } = earlierRig();
  // the old first message (seq 30) sits 20 px down until the page lands above it; the streamed message adds 100 px below
  Object.defineProperty(thread, 'scrollHeight', { get: () => 1000 + (f.html().includes('said 10') ? 600 : 0) + (f.html().includes('said 41') ? 100 : 0) });
  const mark = f.withSelector('[data-anchor]', { presentIf: /data-anchor/ });
  Object.defineProperty(mark, 'offsetTop', { get: () => 20 + (f.html().includes('said 10') ? 600 : 0) });
  const store = started(f, h);
  await h.ready();
  const follow = h.streams.find(s => s.name === 'session/follow');
  follow.cbs.onItem({ type: 'snapshot', header: {}, cursor: 40, hasMore: true, records: [said(30), said(31)], projections: { asOfSeq: 40, values: {} } });
  await settle();
  assert.match(f.html(), /<div data-anchor class="msg you"><div class="bubble you">said 30</);
  thread.scrollTop = 0;
  f.fire('root', 'pointerdown', { button: 0 });
  f.click({ tagName: 'BUTTON', dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  follow.cbs.onItem({ type: 'event', event: said(41).event });
  await settle();
  assert.doesNotMatch(f.html(), /said 10/, 'held while the press is down');
  f.fire('doc', 'pointerup', { button: 0 });
  await settle();
  assert.match(f.html(), /said 10[\s\S]*said 41/);
  assert.equal(thread.scrollTop, 600, 'the page above, not the frame below, moves the reader');
  store.timers.clear();
});

test('on a narrow window the document scrolls, not the thread: the keep moves the document', async () => {
  const { f, thread, h } = earlierRig();
  Object.defineProperty(thread, 'clientHeight', { get: () => thread.scrollHeight }); // the thread as tall as what it holds
  f.doc.scrollingElement = { scrollTop: 0 };
  const store = started(f, h);
  await h.ready();
  h.streams.find(s => s.name === 'session/follow').cbs.onItem({ type: 'snapshot', header: {}, cursor: 40, hasMore: true, records: [said(30), said(31)], projections: { asOfSeq: 40, values: {} } });
  await settle();
  f.doc.scrollingElement.scrollTop = 300;
  f.click({ tagName: 'BUTTON', dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  assert.match(f.html(), /said 10/);
  assert.equal(f.doc.scrollingElement.scrollTop, 900);
  store.timers.clear();
});

test('at the tail, a streamed message still follows the tail', async () => {
  const { f, thread, h } = earlierRig();
  const store = started(f, h);
  await h.ready();
  const follow = h.streams.find(s => s.name === 'session/follow');
  follow.cbs.onItem({ type: 'snapshot', header: {}, cursor: 40, hasMore: true, records: [said(30), said(31)], projections: { asOfSeq: 40, values: {} } });
  await settle();
  assert.equal(thread.scrollTop, 1000, 'a conversation opens at its tail');
  thread.scrollTop = 600; // at the bottom: 1000 - 600 - 400 = 0
  follow.cbs.onItem({ type: 'event', event: said(41).event });
  await settle();
  assert.equal(thread.scrollTop, 1000);
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
  f.click({ tagName: 'BUTTON', dataset: { action: 'setTheme', value: 'cream' } });
  assert.equal(f.doc.documentElement.dataset.theme, 'cream');
  assert.equal(JSON.parse(m.get('gravit-ui.prefs')).theme, 'cream');
  f.click({ tagName: 'BUTTON', dataset: { action: 'setTheme', value: 'black' } });
  assert.equal(f.doc.documentElement.dataset.theme, 'black', 'the seg value is the key, stored as it is');
  assert.equal(JSON.parse(m.get('gravit-ui.prefs')).theme, 'black');
  store.timers.clear();
});

// the sizes and fonts (plan 6 Task 13): the page's root style recorded, the prefs a memory
const prefsPage = (m = new Map()) => {
  const storage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  const f = fakeWindow({ hash: '', storage });
  const props = new Map();
  f.doc.documentElement.style = { setProperty: (k, v) => props.set(k, v), removeProperty: k => { props.delete(k); } };
  return { f, m, props, store: started(f, host()) };
};
const stepKey = (pref, step) => ({ tagName: 'BUTTON', dataset: { action: 'stepPref', pref, step } });

test('+ on Text size reads 16 px, sets --fs and survives a reload', () => {
  const { f, m, props, store } = prefsPage();
  store.dispatch('openSettings');
  assert.match(f.html(), /<output id="pref-textSize" class="stepper-out">15 px<\/output>/);
  assert.equal(props.has('--fs'), false, 'nothing set at the default');
  f.click(stepKey('textSize', '1'));
  assert.match(f.html(), /<output id="pref-textSize" class="stepper-out">16 px<\/output>/);
  assert.equal(props.get('--fs'), String(16 / 15));
  assert.equal(JSON.parse(m.get('gravit-ui.prefs')).textSize, 16);
  store.timers.clear();
  const again = prefsPage(m);
  assert.equal(again.store.get().textSize, 16, 'a new boot reads it');
  assert.equal(again.props.get('--fs'), String(16 / 15), 'and applies it on boot');
  again.store.timers.clear();
});

// (aria-disabled, not disabled: the key keeps its focus at the end of the range, and a press on it does nothing)
test('− stops at 12 and its key is aria-disabled, still focusable', () => {
  const { f, props, store } = prefsPage();
  store.dispatch('openSettings');
  for (let i = 0; i < 6; i++) f.click(stepKey('textSize', '-1'));
  assert.equal(store.get().textSize, 12);
  assert.equal(props.get('--fs'), String(12 / 15));
  assert.match(f.html(), /<button type="button" class="key" data-action="stepPref" data-pref="textSize" data-step="-1" aria-label="Smaller text" aria-disabled="true">/);
  assert.doesNotMatch(f.html(), /data-action="stepPref"[^>]* disabled[ >]/, 'never disabled');
  assert.match(f.html(), /data-pref="textSize" data-step="1" aria-label="Larger text">/, 'its other key stays live');
  for (let i = 0; i < 9; i++) f.click(stepKey('codeSize', '1'));
  assert.equal(store.get().codeSize, 16);
  assert.match(f.html(), /data-pref="codeSize" data-step="1" aria-label="Larger code" aria-disabled="true">/);
  const ended = { ...stepKey('codeSize', '-1'), getAttribute: k => (k === 'aria-disabled' ? 'true' : null) };
  f.click(ended);
  assert.equal(store.get().codeSize, 16, 'a press on an aria-disabled key does nothing');
  store.timers.clear();
});

test('a typed code font is applied on change and cleared by an empty field', () => {
  const { f, m, props, store } = prefsPage();
  store.dispatch('openSettings');
  const box = { tagName: 'INPUT', type: 'text', id: 'pref-codeFont', value: 'JetBrains Mono', dataset: { action: 'setFont', pref: 'codeFont' } };
  f.fire('root', 'change', { target: box });
  assert.equal(props.get('--font-mono'), '"JetBrains Mono", var(--font-mono-base)');
  assert.equal(JSON.parse(m.get('gravit-ui.prefs')).codeFont, 'JetBrains Mono');
  assert.match(f.html(), /id="pref-codeFont"[^>]*value="JetBrains Mono"/);
  f.fire('root', 'change', { target: { ...box, value: 'Inter"; } body { display:none' } });
  assert.equal(props.get('--font-mono'), '"Inter body display none", var(--font-mono-base)', 'a hostile family lands cleaned');
  f.fire('root', 'change', { target: { ...box, value: '' } });
  assert.equal(props.has('--font-mono'), false);
  assert.equal(JSON.parse(m.get('gravit-ui.prefs')).codeFont, '');
  store.timers.clear();
});

// while a turn streams each render writes the box back by script, so its blur fires no change: the input commits it
test('a code font typed while renders run is kept without a change event', () => {
  const { f, m, props, store } = prefsPage();
  store.dispatch('openSettings');
  const box = f.withId('pref-codeFont', { tagName: 'INPUT', type: 'text', value: '', dataset: { action: 'setFont', pref: 'codeFont' } });
  box.value = 'Fira ';
  f.fire('root', 'input', { target: box });
  assert.equal(box.value, 'Fira ', 'the box is not rewritten while typing: a space can be typed');
  box.value = 'Fira Code';
  f.fire('root', 'input', { target: box });
  store.dispatch('setTheme', 'black');   // a render, as a stream frame is
  f.fire('root', 'blur', { target: box });
  assert.equal(store.get().codeFont, 'Fira Code');
  assert.equal(props.get('--font-mono'), '"Fira Code", var(--font-mono-base)');
  assert.equal(JSON.parse(m.get('gravit-ui.prefs')).codeFont, 'Fira Code');
  box.value = 'Fira"; }';
  f.fire('root', 'input', { target: box });
  assert.equal(store.get().codeFont, 'Fira', 'the reducer cleans');
  store.timers.clear();
});

test('the fold stays open across a render', () => {
  const { f, store } = prefsPage();
  store.dispatch('openSettings');
  assert.match(f.html(), /<details id="more-fonts" class="fold"><summary>More font settings<\/summary>/);
  f.withSelector('details[id][open]', { tagName: 'DETAILS', id: 'more-fonts', open: true });
  const again = f.withId('more-fonts', { tagName: 'DETAILS', open: false });
  f.click(stepKey('codeSize', '1'));
  assert.equal(again.open, true, 'the render opens it again by its id');
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
  const getJson = async path => { reads.push(path); return path.startsWith('/data/market/explore?q=600&') ? fx('explore-search-china') : h.getJson(path); };
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
  assert.equal(reads.some(p => p.startsWith('/data/market/explore?q=')), false, 'nothing searched before the wait');
  timers.run(300);
  await settle();
  assert.deepEqual(reads.filter(p => p.startsWith('/data/market/explore?q=')), ['/data/market/explore?q=600&limit=200'], "one read, the Account's");
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
  assert.ok(reads.includes('/data/market/explore?limit=200'), "Markets on screen reads the Account's explore");
  assert.ok(reads.includes('/data/market/candles?venue=china&symbol=600519&range=1D'), 'its history at venue china');
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
    // the market's explore, and the account's connected one beside it listing nothing: their join is the stand-in's rows
    case '/data/market/explore': return fx('explore-all');
    case '/data/account/connected/explore': return { ok: true, asOf: '2026-10-22T08:00:00.000Z', items: [], movers: [], closing: [], mostTraded: [], tabs: [], missing: [], notes: [] };
    case '/data/market/candles':
    case '/data/account/connected/candles': return { ...fx('candles'), venue: q.get('venue'), symbol: q.get('symbol'), range: q.get('range') };
    case '/data/account/compare': return { ...fx('compare'), base: q.get('base') };
    case '/data/market/quotes':
    case '/data/account/connected/quotes': return { ok: true, quotes: [] };
    // a market page's four reads (plan 4a Task 4): the asset sheet the stand-in keeps for the key, else an empty one; its book (the
    // best bid and ask alone), its trades (none published), no funding
    case '/data/account/asset': return ASSET_SHEETS[q.get('key')] ? fx(ASSET_SHEETS[q.get('key')]) : { ok: true, key: q.get('key'), positions: [], orders: [], lines: [], cost: [], missing: [] };
    case '/data/market/book':
    case '/data/account/connected/book': return { ...fx('book'), venue: q.get('venue'), symbol: q.get('symbol') };
    // a public line's trades are the market's answer, a connected line's the Account's (each its own words)
    case '/data/market/trades': return { ...fx('trades'), venue: q.get('venue'), symbol: q.get('symbol') };
    case '/data/account/connected/trades': return { ...fx('connected-trades'), venue: q.get('venue'), symbol: q.get('symbol') };
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
  for (const read of ['/data/account/holdings?cost=1', '/data/account/holdings?cost=1&paper=1', '/data/account/statement', '/data/account/connected/candles?venue=ex&symbol=BTC%2FUSDT&range=1D', '/data/account/compare?base=BTC&side=buy',
    '/data/account/asset?key=crypto%3ABTC', '/data/account/connected/book?venue=ex&symbol=BTC%2FUSDT&depth=10', '/data/account/connected/trades?venue=ex&symbol=BTC%2FUSDT&limit=20']) {
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
  assert.deepEqual(h.reads, ['/data/account/connected/candles?venue=ex&symbol=BTC%2FUSDT&range=1M']);
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
  assert.ok(h.reads.includes('/data/market/candles?venue=china&symbol=600519&range=1D'), JSON.stringify(h.reads));
  assert.equal(h.reads.some(r => r.startsWith('/data/account/holdings')), false, 'nothing held of an A share is read from the Account');
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'setRange', id: 'cn:600519', value: '1M' } });
  await settle();
  assert.ok(h.reads.includes('/data/market/candles?venue=china&symbol=600519&range=1M'), JSON.stringify(h.reads));
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
  assert.ok(h.reads.includes('/data/market/candles?venue=china&symbol=600519&range=1D'), JSON.stringify(h.reads));
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
  const quoted = () => h.reads.filter(p => p.startsWith('/data/account/connected/quotes?')).map(p => new URLSearchParams(p.split('?')[1]).get('pairs').split(',').sort());
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
  const searched = () => h.reads.filter(p => p.startsWith('/data/market/explore?q='));
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
  assert.deepEqual(searched(), ['/data/market/explore?q=BTC&limit=200'], "the Account's search, once, for what was typed last — the A shares' with it");
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
  const said = store.get().account.grantSaid;
  assert.match(said, /^Not opened: where this account can connect was not read(?: — .+)?\. Try Grant again\.$/, 'the line as the store holds it, in plain text');
  assert.ok(f.html().includes(`<p class="acct-note">${said.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`), 'escaped once at the draw');
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
  assert.ok(h.reads.includes('/data/market/explore?tab=crypto&limit=12'), "the kind's picks");
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
  const searches = () => h.reads.filter(p => p.startsWith('/data/market/explore?q='));
  box('so');
  box('sol');
  await settle();
  assert.deepEqual(searches(), [], 'nothing before the quiet');
  assert.equal(timers.delays().filter(ms => ms === 300).length, 1, 'a keystroke restarts the wait');
  timers.run(300);
  await settle();
  assert.deepEqual(searches(), ['/data/market/explore?q=sol&limit=12']);
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
  assert.ok(h.reads.includes('/data/market/candles?venue=china&symbol=600001&range=1D'), 'its history at venue china');
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

test('a pointer pick chooses the row pressed, though a late answer reorders the rows before the click', async () => {
  const waiting = [];
  const files = path => new Promise(resolve => waiting.push({ path, resolve }));
  const rows = [titled('s1', 'Alpha', { updatedAt: 50, agentAvailable: true }), titled('s2', 'Beta', { updatedAt: 9 }), titled('s3', 'Gamma', { updatedAt: 5 })];
  const { f, say, slot, store } = await menuRig({ files, rows });
  typeMenu(f, say, '@');
  await settle();
  assert.match(slot.innerHTML, /data-index="1"[^]*Gamma/, 'Beta, Gamma before the files answer');
  const row1 = { dataset: { index: '1' } };
  f.fire('root', 'pointerdown', { button: 0, target: { closest: sel => (sel === '.cmenu' ? {} : sel === '.cmenu-row' ? row1 : null) } });
  waiting.at(-1).resolve({ ok: true, items: FILES, truncated: false });
  await settle();
  assert.match(slot.innerHTML, /x\.md/, 'the files drew above the conversations');
  f.click({ tagName: 'DIV', dataset: { action: 'menuPick', index: '1' } });
  f.fire('doc', 'pointerup');
  assert.deepEqual(say.runs, [{ type: 'chip', chip: { kind: 'conversation', id: 's3', label: 'Gamma' } }, { type: 'text', text: ' ' }]);
  store.timers.clear();
});

test('a click that moves the caret off the token closes the menu, and Enter then sends', async () => {
  const { f, say, slot, h, store } = await menuRig();
  typeMenu(f, say, 'see @str');
  await settle();
  assert.notEqual(slot.innerHTML, '');
  say.setSelectionRange(2, 2);
  f.fire('root', 'click', { target: say });
  assert.equal(slot.innerHTML, '', 'the caret left the token');
  assert.equal(say.attributes['aria-expanded'], 'false');
  assert.equal(press(f, say, 'Enter'), true);
  await settle();
  assert.equal(say.runs?.some(r => r.type === 'chip') ?? false, false, 'nothing chosen');
  assert.ok(promptsOf(h).length + saysOf(h).length > 0, 'the draft was sent');
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

test('a typed @buffett after a chip still reads as a mention: text runs are joined across chips as a space', async () => {
  const { f, say, h, store } = await menuRig();
  putRuns(f, say, [{ type: 'text', text: 'hi' }, { type: 'chip', chip: { kind: 'file', path: 'strategies/alpha/notes.md', dir: false, label: 'notes.md' } }, { type: 'text', text: '@buffett look' }]);
  send(f);
  await settle();
  assert.equal(saysOf(h).length, 1, 'the typed @buffett tries the room');
  store.timers.clear();
});

test('a typed @buffett with a conversation chip in a channel is refused before sending, and the draft stays', async () => {
  const { f, say, h, store } = await menuRig();
  const draft = [{ type: 'text', text: '@buffett see ' }, { type: 'chip', chip: { kind: 'conversation', id: 's2', label: 'Beta' } }];
  putRuns(f, say, draft);
  send(f);
  await settle();
  assert.deepEqual(saysOf(h), []);
  assert.deepEqual(promptsOf(h), []);
  assert.equal(store.get().status.line, "Conversations go to Gravit, not to a room's bots");
  store.dispatch('toggleRail');
  assert.deepEqual(say.runs, draft);
  store.timers.clear();
});

// ---- files in the draft (plan 4 task 5): pick, paste, drop, upload, remove, retry ----
const MiB = 1048576;
const LIMITS = { maxImageBytes: 20 * MiB, maxImagesPerMessage: 20, maxMessageImageBytes: 200 * MiB, maxImagePixels: 64e6, maxImageDimension: 8192, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] };
const aFile = (name, size, type) => ({ name, size, type, arrayBuffer: async () => new ArrayBuffer(0) });
const CSV = () => aFile('prices.csv', Math.round(2.8 * MiB), 'text/csv');
const PNG = () => aFile('chart.png', 300 * 1024, 'image/png');
// host.attachments: the limits as given, each upload recorded with its progress callback and its answer or failure
function fakeAttachments(limits = LIMITS) {
  const uploads = [];
  const limitReads = [];
  return {
    uploads, limitReads,
    limits: () => limits,
    readLimits: async id => { limitReads.push(id); return true; },
    upload(id, file, onProgress) {
      const u = { id, file, onProgress, aborted: false };
      u.done = new Promise((resolve, reject) => { u.answer = resolve; u.fail = reject; });
      u.abort = () => { u.aborted = true; u.fail(Object.assign(new Error('aborted'), { code: 'aborted' })); };
      uploads.push(u);
      return { done: u.done, abort: u.abort };
    },
    thumb: async () => {},
  };
}
// the composer's own elements: the editor, the hidden input, the rail (its writes counted) and the note
function composerEls(f) {
  const say = f.withId('say', { tagName: 'INPUT' });
  const input = f.withId('attach-input', { tagName: 'INPUT', type: 'file' });
  const rail = f.withId('composer-files');
  rail.railWrites = 0;
  let railHtml = '';
  Object.defineProperty(rail, 'innerHTML', { get: () => railHtml, set: v => { railHtml = v; rail.railWrites++; } });
  const note = f.withId('composer-note');
  return { say, input, rail, note };
}
const bootFiles = async (f, h, attachments, editor = valueEditor, more = {}) => {
  const store = boot(f.win, { ...more, editor, attachments, openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown });
  await h.ready();
  return store;
};
const pick = (f, input, files) => { input.files = files; input.value = 'C:\\fakepath\\x'; f.fire('root', 'change', { target: input }); };
const twoRows = () => host({ rows: [row('s1', { updatedAt: 50, agentAvailable: true }), row('s2', { updatedAt: 9, agentAvailable: true })] });

test('the paperclip clicks the hidden input, and its files join the draft with one render, an image with its object URL', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  const made = [];
  f.win.URL.createObjectURL = blob => { made.push(blob); return 'blob:chart'; };
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  assert.match(f.html(), /data-action="attachFiles" aria-label="Attach files"/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'attachFiles' } });
  assert.equal(input.clicks, 1);
  const before = f.writes;
  const png = PNG(), csv = CSV();
  pick(f, input, [png, csv]);
  assert.equal(f.writes, before + 1, 'one render');
  assert.equal(input.value, '', 'the input is cleared, so the same file can be picked again');
  assert.deepEqual(made, [png], 'an object URL for the image only');
  assert.match(f.html(), /<div class="attach-image"><img src="blob:chart" alt="chart.png">/);
  assert.match(f.html(), /file-name">prices.csv</);
  store.timers.clear();
});

test('a file added to a conversation uploads at once; a progress tick writes only the rail; the receipt marks it up', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input, rail } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  const csv = CSV();
  pick(f, input, [csv, PNG()]);
  assert.equal(att.uploads.length, 1, 'the file uploads; the image goes inline when sent');
  assert.equal(att.uploads[0].id, 's1');
  assert.equal(att.uploads[0].file, csv, 'the File itself is the body');
  assert.match(f.html(), /file-card uploading/);
  assert.match(f.html(), /file-meta">0.0 \/ 2.8 MB</);
  const writes = f.writes;
  att.uploads[0].onProgress(Math.round(1.1 * MiB));
  assert.equal(f.writes, writes, 'a progress tick never renders the page');
  assert.equal(rail.railWrites, 1);
  assert.match(rail.innerHTML, /1.1 \/ 2.8 MB/);
  att.uploads[0].answer('rcpt-1');
  await settle();
  assert.equal(f.writes, writes + 1, 'the receipt renders');
  assert.doesNotMatch(f.html(), /file-card uploading/);
  assert.match(f.html(), /file-meta">CSV · 2.8 MB</);
  store.timers.clear();
});

test('a failed upload draws Retry, and Retry uploads again', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [CSV()]);
  att.uploads[0].fail(new Error('upload prices.csv: the request failed'));
  await settle();
  assert.match(f.html(), /file-card failed/);
  assert.match(f.html(), /Upload failed · <button type="button" class="file-retry" data-action="attachRetry" data-key="(a\d+)">Retry<\/button>/);
  const key = f.html().match(/data-action="attachRetry" data-key="(a\d+)"/)[1];
  f.click({ tagName: 'BUTTON', dataset: { action: 'attachRetry', key } });
  assert.equal(att.uploads.length, 2, 'uploaded again');
  assert.equal(att.uploads[1].id, 's1');
  assert.match(f.html(), /file-card uploading/);
  att.uploads[1].answer('rcpt-2');
  await settle();
  assert.doesNotMatch(f.html(), /Upload failed/);
  store.timers.clear();
});

test('removing a file mid-upload aborts it, and removing an image revokes its URL', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input, rail } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [CSV(), PNG()]);
  const keys = [...f.html().matchAll(/data-action="attachRemove" data-key="(a\d+)"/g)].map(m => m[1]);
  assert.equal(keys.length, 2);
  f.click({ tagName: 'BUTTON', dataset: { action: 'attachRemove', key: keys[0] } });
  assert.equal(att.uploads[0].aborted, true);
  assert.doesNotMatch(f.html(), /prices.csv/);
  const writes = f.writes;
  att.uploads[0].onProgress(100);
  await settle();
  assert.equal(rail.railWrites, 0, 'a late tick of the removed file writes nothing');
  assert.equal(f.writes, writes, 'nor does its abort land');
  f.click({ tagName: 'BUTTON', dataset: { action: 'attachRemove', key: keys[1] } });
  assert.deepEqual(f.revoked, ['blob:fake']);
  assert.doesNotMatch(f.html(), /chart.png/);
  store.timers.clear();
});

test('an image over the limit is refused above the box by name, and the rest are added', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input, note } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [aFile('huge.png', 21 * MiB, 'image/png'), PNG(), CSV()]);
  assert.match(f.html(), /id="composer-note" role="status">huge.png is over 20 MB</);
  assert.equal(note.textContent, 'huge.png is over 20 MB', 'the live region is written');
  assert.doesNotMatch(f.html(), /alt="huge.png"/);
  assert.match(f.html(), /alt="chart.png"/);
  assert.match(f.html(), /prices.csv/);
  const key = f.html().match(/data-action="attachRemove" data-key="(a\d+)"/)[1];
  f.click({ tagName: 'BUTTON', dataset: { action: 'attachRemove', key } });
  assert.match(f.html(), /id="composer-note" role="status"><\/div>/, 'a remove clears the note');
  assert.equal(note.textContent, '');
  store.timers.clear();
});

test('on New message files wait as ready and nothing uploads', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  pick(f, input, [CSV()]);
  assert.equal(att.uploads.length, 0);
  assert.match(f.html(), /<div class="file-card"><span class="file-icon">/);
  assert.match(f.html(), /file-meta">CSV · 2.8 MB</);
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.doesNotMatch(f.html(), /prices.csv/, 'the file is New message\'s');
  store.timers.clear();
});

test('a paste of files adds them and inserts no text', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  say.focus();
  type(f, say, 'ab');
  say.setSelectionRange(2, 2);
  let prevented = false;
  f.fire('root', 'paste', { target: say, preventDefault() { prevented = true; }, clipboardData: { files: [PNG()], getData: () => '' } });
  assert.equal(prevented, true);
  assert.equal(say.value, 'ab', 'no text inserted');
  assert.match(f.html(), /alt="chart.png"/);
  f.fire('root', 'paste', { target: say, clipboardData: { files: [], getData: t => (t === 'text/plain' ? 'X' : '') } });
  assert.equal(say.value, 'abX', 'a paste with no files is still plain text');
  store.timers.clear();
});

test('a rich copy (text/plain and text/html, with a picture of it in files) pastes its text and attaches nothing', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  say.focus();
  const data = { 'text/plain': 'A1\tB1', 'text/html': '<table><tr><td>A1</td><td>B1</td></tr></table>' };
  const writes = f.writes;
  f.fire('root', 'paste', { target: say, clipboardData: { files: [aFile('image.png', 2048, 'image/png')], getData: t => data[t] ?? '' } });
  assert.equal(say.value, 'A1\tB1');
  assert.equal(f.writes, writes, 'nothing added, nothing rendered');
  assert.doesNotMatch(f.html(), /image.png/);
  store.timers.clear();
});

test('a drop of files on the page adds them to the draft on screen; the overlay shows while files are dragged over and goes once they stop', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const timers = new HeldTimers(ms => ms === DROP_QUIET_MS);
  const store = await bootFiles(f, h, att, valueEditor, { timers });
  let prevented = false;
  f.fire('doc', 'dragover', { target: f.body, dataTransfer: { types: ['Files'] }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'the page takes the drop');
  assert.equal(store.get().dropping, true);
  assert.match(f.html(), /Drop files or images here<\/div><div class="drop-sub">Images: up to 20 a message, 20 MB each</);
  const writes = f.writes;
  f.fire('doc', 'dragover', { target: f.body, dataTransfer: { types: ['Files'] } });
  assert.equal(f.writes, writes, 'a second dragover renders nothing');
  f.fire('doc', 'dragleave', { relatedTarget: null });
  assert.equal(store.get().dropping, true, 'a leave alone clears nothing: the watchdog does');
  timers.run(DROP_QUIET_MS);
  assert.equal(store.get().dropping, false);
  assert.doesNotMatch(f.html(), /drop-overlay/);
  f.fire('doc', 'dragover', { target: f.body, dataTransfer: { types: ['Files'] } });
  f.fire('doc', 'dragend', {});
  assert.equal(store.get().dropping, false, 'dragend clears it');
  assert.deepEqual(timers.delays(), [], 'and its watchdog');
  f.fire('doc', 'dragover', { target: f.body, dataTransfer: { types: ['Files'] } });
  prevented = false;
  f.fire('doc', 'drop', { target: f.body, dataTransfer: { types: ['Files'], files: [CSV()], getData: () => '' }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(store.get().dropping, false);
  assert.doesNotMatch(f.html(), /drop-overlay/);
  assert.match(f.html(), /prices.csv/);
  assert.equal(att.uploads.length, 1);
  // a screen with no composer: no overlay, and a drop adds nothing
  f.click({ tagName: 'BUTTON', dataset: { action: 'openMarket', id: 'crypto:BTC' } });
  await settle();
  assert.equal(store.get().route.screen, 'markets');
  f.fire('doc', 'dragover', { target: f.body, dataTransfer: { types: ['Files'] } });
  assert.equal(store.get().dropping, false);
  f.fire('doc', 'drop', { target: f.body, dataTransfer: { types: ['Files'], files: [PNG()], getData: () => '' } });
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.doesNotMatch(f.html(), /chart.png/);
  store.timers.clear();
});

test('a drop of HTML on the editor inserts its plain text only, never a chip', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const { writes, editor } = recording();
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att, editor);
  const asked = [];
  const data = { 'text/html': '<span data-chip=\'{"kind":"bot","id":"x","label":"x"}\'>x</span>', 'text/plain': 'x' };
  let prevented = false;
  let overSay = false;
  f.fire('doc', 'dragover', { target: say, dataTransfer: { types: ['text/html', 'text/plain'] }, preventDefault() { overSay = true; } });
  assert.equal(overSay, true, 'text may be dropped on the editor');
  f.fire('doc', 'drop', {
    target: say, clientX: 5, clientY: 6, preventDefault() { prevented = true; },
    dataTransfer: { types: ['text/html', 'text/plain'], files: [], getData: t => { asked.push(t); return data[t] ?? ''; } },
  });
  assert.equal(prevented, true, 'the browser never drops the markup itself');
  assert.deepEqual(asked, ['text/plain'], 'text/html is never read');
  assert.deepEqual(writes.at(-1)[1], [{ type: 'text', text: 'x' }]);
  assert.equal(say.value, 'x');
  store.timers.clear();
});

test('a drop on the editor goes in at the point under the pointer', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const points = [];
  const editor = { ...valueEditor, pointAt: (el, x, y) => { points.push([el, x, y]); return 1; } };
  const store = await bootFiles(f, h, fakeAttachments(), editor);
  type(f, say, 'ab');
  say.setSelectionRange(2, 2);
  f.fire('doc', 'drop', { target: say, clientX: 5, clientY: 6, dataTransfer: { types: ['text/plain'], files: [], getData: t => (t === 'text/plain' ? 'X' : '') } });
  assert.deepEqual(points, [[say, 5, 6]]);
  assert.equal(say.value, 'aXb');
  assert.equal(say.selectionStart, 2, 'the caret after the dropped text');
  store.timers.clear();
});

test('a drag that starts in the editor is cancelled', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootFiles(f, h, fakeAttachments());
  let prevented = false;
  f.fire('doc', 'dragstart', { target: { tagName: 'SPAN', closest: sel => (sel === '#say' ? say : null) }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  prevented = false;
  f.fire('doc', 'dragstart', { target: { tagName: 'IMG', closest: () => null }, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'a drag elsewhere on the page is the browser\'s');
  store.timers.clear();
});

test('switching conversations mid-upload: the progress and the receipt land in the first draft, the second\'s rail is never written', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input, rail } = composerEls(f);
  const h = twoRows();
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [CSV()]);
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  assert.doesNotMatch(f.html(), /prices.csv/, 'B has no files');
  att.uploads[0].onProgress(Math.round(1.1 * MiB));
  assert.equal(rail.railWrites, 0, "B's rail is never written by A's tick");
  att.uploads[0].answer('rcpt-1');
  await settle();
  assert.doesNotMatch(f.html(), /prices.csv/, "A's receipt lands in A, not on screen");
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.match(f.html(), /file-meta">CSV · 2.8 MB</, 'A shows the file up on return');
  assert.doesNotMatch(f.html(), /file-card uploading/);
  store.timers.clear();
});

test('a draft with files and no words stays when its conversation is left and opened again', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input, say } = composerEls(f);
  const h = twoRows();
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [PNG()]);
  type(f, say, 'x');
  type(f, say, '');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.match(f.html(), /alt="chart.png"/);
  assert.equal(att.limitReads.length, 1, 'the image limits read once a read succeeds, on the first conversation opened');
  assert.equal(att.limitReads[0], 's1');
  store.timers.clear();
});

test('the overlay stays while dragovers keep coming, and goes DROP_QUIET_MS after the last', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const timers = new HeldTimers(ms => ms === DROP_QUIET_MS);
  const store = await bootFiles(f, h, fakeAttachments(), valueEditor, { timers });
  f.fire('doc', 'dragover', { target: f.body, dataTransfer: { types: ['Files'] } });
  const first = timers.ids();
  assert.equal(first.length, 1);
  f.fire('doc', 'dragover', { target: f.body, dataTransfer: { types: ['Files'] } });
  assert.equal(timers.ids().length, 1, 'one watchdog');
  assert.notEqual(timers.ids()[0], first[0], 'each dragover restarts it');
  assert.equal(store.get().dropping, true);
  timers.run(DROP_QUIET_MS);
  assert.equal(store.get().dropping, false, 'a leave the page never heard of still ends it');
  store.timers.clear();
});

test('a drop that carries no files and lands outside the editor is the browser\'s (a search box, a sheet\'s field)', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootFiles(f, h, fakeAttachments());
  let prevented = false;
  const box = { tagName: 'INPUT', id: 'cq', closest: () => null };
  f.fire('doc', 'drop', { target: box, dataTransfer: { types: ['text/plain'], files: [], getData: () => 'BTC' }, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  f.fire('doc', 'drop', { target: box, dataTransfer: { types: ['Files'], files: [CSV()], getData: () => '' }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'files are always the page\'s');
  store.timers.clear();
});

test('a data: or blob: URL dropped on the editor (an image dragged out of the thread) inserts nothing', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootFiles(f, h, fakeAttachments());
  type(f, say, 'ab');
  for (const url of ['data:image/png;base64,iVBORw0KGgo=', 'blob:http://127.0.0.1:3091/5f2c', ' DATA:text/html,x']) {
    let prevented = false;
    f.fire('doc', 'drop', { target: say, dataTransfer: { types: ['text/plain', 'text/uri-list'], files: [], getData: t => (t === 'text/plain' ? url : '') }, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(say.value, 'ab', url);
  }
  store.timers.clear();
});

test("a failed upload says why on the status line, the host's hint and all", async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [CSV()]);
  const why = 'upload prices.csv: not signed in - open the URL gravit-face printed when it started (…/?token=…)';
  att.uploads[0].fail(Object.assign(new Error(why), { status: 401 }));
  await settle();
  assert.deepEqual([store.get().status.line, store.get().status.bad], [why, true]);
  assert.match(f.html(), /Upload failed · /);
  store.timers.clear();
});

test('a failed image-limits read is tried again on the next conversation opened; a good one is never read again', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  composerEls(f);
  const h = host({ rows: [row('s1', { updatedAt: 50, agentAvailable: true }), row('s2', { updatedAt: 9 }), row('s3', { updatedAt: 8 })] });
  const att = fakeAttachments();
  const answers = [false, true];
  att.readLimits = async id => { att.limitReads.push(id); return answers.shift() ?? true; };
  const store = await bootFiles(f, h, att);
  await settle();
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's3' } });
  await settle();
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.deepEqual(att.limitReads, ['s1', 's2']);
  store.timers.clear();
});

test('the note above the box keeps its node across renders, so the live region speaks the new line', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  // #composer-note as the browser has it: each page write makes a fresh node from the markup; replaceWith puts another in its place
  const made = [];
  let current = null, at = -1;
  const byId = f.doc.getElementById.bind(f.doc);
  f.doc.getElementById = id => {
    if (id !== 'composer-note') return byId(id);
    if (at !== f.writes) {
      at = f.writes;
      const words = f.html().match(/id="composer-note" role="status">([^<]*)</)?.[1] ?? null;
      if (words === null) { current = null; return null; }
      const node = { textContent: words, replaceWith(other) { current = other; } };
      made.push(node);
      current = node;
    }
    return current;
  };
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootFiles(f, h, fakeAttachments());
  const first = f.doc.getElementById('composer-note');
  assert.ok(first);
  pick(f, input, [aFile('huge.png', 21 * MiB, 'image/png')]);
  assert.ok(made.length > 1, 'the page write made a new node');
  assert.equal(f.doc.getElementById('composer-note'), first, 'the first node is back in place');
  assert.equal(first.textContent, 'huge.png is over 20 MB');
  store.timers.clear();
});

test('a Finder file copy (its name as text/plain, no text/html) attaches the file and inserts no text', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootFiles(f, h, fakeAttachments());
  say.focus();
  type(f, say, 'ab');
  f.fire('root', 'paste', { target: say, preventDefault() {}, clipboardData: { files: [PNG()], getData: t => (t === 'text/plain' ? 'chart.png' : '') } });
  assert.equal(say.value, 'ab', 'the name is not inserted');
  assert.match(f.html(), /alt="chart.png"/);
  store.timers.clear();
});

// ---- sending with files (plan 4 task 6) ----
const PNG_BYTES = [137, 80, 78, 71];
const pngFile = (name = 'chart.png') => ({ name, size: 300 * 1024, type: 'image/png', arrayBuffer: async () => new Uint8Array(PNG_BYTES).buffer });
const contentsOf = h => h.calls.filter(c => c[0] === 'session/prompt').map(c => [c[1].request.sessionId, c[1].request.content]);
// no file part ever leaves with an undefined receipt (Task 1's review)
const noBareReceipts = h => {
  for (const [endpoint, args] of h.calls) {
    const parts = endpoint === 'session/prompt' ? args.request.content : endpoint === 'commands/execute' ? args.submittedAttachments : [];
    for (const p of parts) if (p.type === 'file') assert.equal(typeof p.receiptId, 'string', `${endpoint} sent a file part with no receipt`);
  }
};
const attachmentInvalid = reason => Object.assign(new Error(`session/prompt: session/attachment-invalid - ${reason}`), { code: 'session/attachment-invalid', details: { reason } });
// session/prompt answered by `answer(n)` for the n-th prompt (from 1): an Error is thrown
const prompting = (h, answer) => {
  const call = h.call;
  let n = 0;
  h.call = async (endpoint, args) => {
    if (endpoint !== 'session/prompt') return call(endpoint, args);
    h.calls.push([endpoint, args]);
    const a = answer(++n);
    if (a instanceof Error) throw a;
    return a;
  };
};
const MODEL_LINE = /Gravit(&#39;|')s model takes no images. Remove the image, or run Gravit on a model that does./;

test('a draft with a file sends its receipt and its words, and the draft clears', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [CSV()]);
  att.uploads[0].answer('rcpt-1');
  await settle();
  type(f, say, 'read it');
  send(f);
  await settle();
  assert.deepEqual(contentsOf(h), [['s1', [{ type: 'text', text: 'read it' }, { type: 'file', receiptId: 'rcpt-1' }]]]);
  assert.equal(say.value, '');
  assert.doesNotMatch(f.html(), /prices.csv/, 'the sent file left the draft');
  noBareReceipts(h);
  store.timers.clear();
});

test('an image goes inline as base64 with its media type and name', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootFiles(f, h, fakeAttachments());
  pick(f, input, [pngFile()]);
  send(f);
  await settle();
  assert.deepEqual(contentsOf(h), [['s1', [{ type: 'image', mediaType: 'image/png', data: 'iVBORw==', name: 'chart.png' }]]], 'no text part for an image alone');
  store.timers.clear();
});

test('files with a bot chip are refused before sending, and a typed @word with files goes to Gravit as a prompt', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = menuHost();
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att, runsEditor);
  pick(f, input, [CSV()]);
  att.uploads[0].answer('rcpt-1');
  await settle();
  const draft = [{ type: 'text', text: 'ask ' }, { type: 'chip', chip: botChip }];
  putRuns(f, say, draft);
  send(f);
  await settle();
  assert.deepEqual(saysOf(h), []);
  assert.deepEqual(promptsOf(h), []);
  assert.equal(store.get().status.line, "Files go to Gravit, not to a room's bots");
  assert.equal(store.get().status.bad, true);
  store.dispatch('toggleRail');
  assert.deepEqual(say.runs, draft, 'the draft stays');
  assert.match(f.html(), /prices.csv/, 'and its file');
  typeMenu(f, say, '@buffett look');
  send(f);
  await settle();
  assert.deepEqual(saysOf(h), [], 'never tried at the room');
  assert.deepEqual(contentsOf(h), [['s1', [{ type: 'text', text: '@buffett look' }, { type: 'file', receiptId: 'rcpt-1' }]]]);
  store.timers.clear();
});

test('a send while a file uploads is refused, and one with a failed file says Retry it or remove it', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [CSV()]);
  type(f, say, 'read it');
  send(f);
  await settle();
  assert.equal(store.get().status.line, 'Files are still uploading');
  assert.equal(say.value, 'read it');
  att.uploads[0].fail(new Error('upload prices.csv: the request failed'));
  await settle();
  send(f);
  await settle();
  assert.equal(store.get().status.line, 'A file did not upload. Retry it or remove it.');
  assert.equal(store.get().status.bad, true);
  assert.deepEqual(promptsOf(h), []);
  assert.equal(say.value, 'read it');
  store.timers.clear();
});

test('/compact with a file is refused as taking no files; /goal, whose input takes attachments, sends them', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const call = h.call;
  h.call = async (endpoint, args) => {
    if (endpoint === 'commands/execute') { h.calls.push([endpoint, args]); return { result: { kind: 'ok', text: 'goal set' } }; }
    return call(endpoint, args);
  };
  const reads = startComposerReads({ call: h.call, getJson: h.getJson, postJson: h.postJson });
  const composerReads = { ...reads, keptCommands: () => [{ name: 'compact' }, { name: 'goal', input: { hint: 'the goal', attachments: true } }] };
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att, valueEditor, { composerReads });
  pick(f, input, [CSV()]);
  att.uploads[0].answer('rcpt-1');
  await settle();
  type(f, say, '/compact');
  send(f);
  await settle();
  assert.equal(store.get().status.line, '/compact takes no files');
  assert.deepEqual(h.calls.filter(c => c[0] === 'commands/execute'), []);
  assert.equal(say.value, '/compact');
  type(f, say, '/goal read the file');
  send(f);
  await settle();
  assert.deepEqual(h.calls.filter(c => c[0] === 'commands/execute').map(c => c[1]), [{ agentId: 's1', line: '/goal read the file', submittedAttachments: [{ type: 'file', receiptId: 'rcpt-1' }] }]);
  assert.equal(say.value, '');
  noBareReceipts(h);
  store.timers.clear();
});

test('a refused image keeps the draft, draws the model line, and the next image there shows it at once with no call', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  prompting(h, () => attachmentInvalid('MODEL_DOES_NOT_SUPPORT_IMAGES'));
  const store = await bootFiles(f, h, fakeAttachments());
  pick(f, input, [pngFile()]);
  type(f, say, 'look');
  send(f);
  await settle();
  assert.equal(promptsOf(h).length, 1);
  assert.equal(say.value, 'look', 'the words came back');
  assert.match(f.html(), /alt="chart.png"/, 'and the image');
  assert.match(f.html(), MODEL_LINE);
  assert.notEqual(store.get().status.line, 'send: session/attachment-invalid (MODEL_DOES_NOT_SUPPORT_IMAGES)', 'the line above the box, not the status line');
  assert.deepEqual(f.revoked, [], 'a kept image keeps its URL');
  const key = f.html().match(/data-action="attachRemove" data-key="(a\d+)"/)[1];
  f.click({ tagName: 'BUTTON', dataset: { action: 'attachRemove', key } });
  assert.doesNotMatch(f.html(), MODEL_LINE, 'removing the image takes the line away');
  pick(f, input, [pngFile('second.png')]);
  assert.match(f.html(), MODEL_LINE, 'the next image says it at once');
  send(f);
  await settle();
  assert.equal(promptsOf(h).length, 1, 'and is never sent');
  store.timers.clear();
});

test("in a bot's conversation the model line names the bot", async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true, projections: { values: { agentPreset: 'buffett' } } })] });
  prompting(h, () => attachmentInvalid('MODEL_DOES_NOT_SUPPORT_IMAGES'));
  const store = await bootFiles(f, h, fakeAttachments());
  assert.equal(store.get().conversations.find(c => c.id === 's1').kind, 'bot');
  pick(f, input, [pngFile()]);
  send(f);
  await settle();
  assert.match(f.html(), /Buffett Type(&#39;|')s model takes no images. Remove the image, or run Buffett Type on a model that does./);
  store.timers.clear();
});

test('a dropped receipt uploads again once and sends; a second drop keeps the draft and says so', async () => {
  const once = async answer => {
    const f = fakeWindow({ hash: '#/messages/s1' });
    const { say, input } = composerEls(f);
    const h = host({ rows: [row('s1', { agentAvailable: true })] });
    prompting(h, answer);
    const att = fakeAttachments();
    const store = await bootFiles(f, h, att);
    pick(f, input, [CSV()]);
    att.uploads[0].answer('rcpt-1');
    await settle();
    type(f, say, 'read it');
    send(f);
    await settle();
    assert.equal(att.uploads.length, 2, 'the file uploads again');
    assert.equal(att.uploads[1].id, 's1');
    assert.equal(say.value, 'read it', 'the draft is back while it does');
    att.uploads[1].answer('rcpt-2');
    await settle();
    return { f, say, h, att, store };
  };
  const good = await once(n => (n === 1 ? attachmentInvalid('FILE_NOT_STAGED') : undefined));
  assert.deepEqual(contentsOf(good.h).map(c => c[1][1]), [{ type: 'file', receiptId: 'rcpt-1' }, { type: 'file', receiptId: 'rcpt-2' }], 'sent once more with the new receipt');
  assert.equal(good.say.value, '');
  assert.doesNotMatch(good.f.html(), /prices.csv/);
  good.store.timers.clear();
  const bad = await once(() => attachmentInvalid('FILE_NOT_STAGED'));
  assert.equal(promptsOf(bad.h).length, 2, 'one more send, no third');
  assert.equal(bad.att.uploads.length, 2, 'no third upload');
  assert.equal(bad.say.value, 'read it');
  assert.match(bad.f.html(), /prices.csv/);
  assert.equal(bad.store.get().status.line, 'send: session/attachment-invalid (FILE_NOT_STAGED)');
  assert.equal(bad.store.get().status.bad, true);
  bad.store.timers.clear();
});

test('New message with a file creates, uploads to the new conversation, then prompts', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  pick(f, input, [CSV()]);
  type(f, say, 'read it');
  send(f);
  await settle();
  assert.equal(att.uploads.length, 1);
  assert.equal(att.uploads[0].id, 's-new', 'uploaded to the conversation just made');
  assert.ok(h.calls.some(c => c[0] === 'session/create'));
  assert.deepEqual(promptsOf(h), [], 'no prompt before the file is up');
  att.uploads[0].answer('rcpt-9');
  await settle();
  assert.deepEqual(contentsOf(h), [['s-new', [{ type: 'text', text: 'read it' }, { type: 'file', receiptId: 'rcpt-9' }]]]);
  assert.equal(store.get().route.id, 's-new');
  assert.equal(say.value, '');
  assert.doesNotMatch(f.html(), /prices.csv/, 'the created conversation took the draft and sent it');
  noBareReceipts(h);
  store.timers.clear();
});

test('New message refused for its image opens the created conversation with the whole draft and the line', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  prompting(h, () => attachmentInvalid('MODEL_DOES_NOT_SUPPORT_IMAGES'));
  const store = await bootFiles(f, h, fakeAttachments());
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  type(f, say, 'look');
  pick(f, input, [pngFile()]);
  send(f);
  await settle();
  assert.equal(promptsOf(h).length, 1);
  assert.equal(store.get().route.id, 's-new', 'the created conversation is open');
  assert.equal(store.get().draft, null);
  assert.equal(say.value, 'look', 'its words');
  assert.match(f.html(), /alt="chart.png"/, 'its image');
  assert.match(f.html(), MODEL_LINE, 'and the line');
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  assert.equal(say.value, '', 'New message is empty again');
  assert.doesNotMatch(f.html(), /chart.png/);
  store.timers.clear();
});

test("a sent draft revokes its images' URLs", async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootFiles(f, h, fakeAttachments());
  pick(f, input, [pngFile()]);
  assert.deepEqual(f.revoked, []);
  send(f);
  await settle();
  assert.deepEqual(f.revoked, ['blob:fake']);
  assert.doesNotMatch(f.html(), /chart.png/);
  store.timers.clear();
});

// ---- sending with files, fix round 1 ----
const executing = (h, answer) => {
  const call = h.call;
  let n = 0;
  h.call = async (endpoint, args) => {
    if (endpoint !== 'commands/execute') return call(endpoint, args);
    h.calls.push([endpoint, args]);
    return answer(++n);
  };
};
const execsOf = h => h.calls.filter(c => c[0] === 'commands/execute').map(c => c[1]);

test('a failed rename on New message opens the conversation with the whole draft, and its waiting file uploads on send', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const title = f.withId('nm-title', { tagName: 'INPUT' });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const call = h.call;
  h.call = async (endpoint, args) => { if (endpoint === 'session/rename') { h.calls.push([endpoint, args]); throw Object.assign(new Error('no'), { code: 'rename/failed' }); } return call(endpoint, args); };
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  title.value = 'Prices';
  f.fire('root', 'input', { target: { ...title, dataset: { action: 'draftTitle' } } });
  pick(f, input, [CSV()]);
  type(f, say, 'read it');
  send(f);
  await settle();
  assert.equal(store.get().route.id, 's-new');
  assert.equal(say.value, 'read it');
  assert.match(f.html(), /prices.csv/);
  assert.equal(att.uploads.length, 0, 'nothing uploaded yet');
  send(f);
  await settle();
  assert.equal(store.get().status.line, 'Files are still uploading', 'a waiting file holds the send');
  assert.equal(att.uploads.length, 1, 'and starts its upload');
  assert.equal(att.uploads[0].id, 's-new');
  att.uploads[0].answer('rcpt-1');
  await settle();
  send(f);
  await settle();
  assert.deepEqual(contentsOf(h), [['s-new', [{ type: 'text', text: 'read it' }, { type: 'file', receiptId: 'rcpt-1' }]]]);
  noBareReceipts(h);
  store.timers.clear();
});

test('a command refusing the files on a cold conversation (no kept rows) keeps the whole draft and shows its text', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  executing(h, () => ({ result: { kind: 'error', text: '/compact does not accept attachments' } }));
  const reads = startComposerReads({ call: h.call, getJson: h.getJson, postJson: h.postJson });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att, valueEditor, { composerReads: { ...reads, keptCommands: () => null } });
  pick(f, input, [CSV()]);
  att.uploads[0].answer('rcpt-1');
  await settle();
  type(f, say, '/compact');
  send(f);
  await settle();
  assert.equal(execsOf(h).length, 1, 'the host judged it');
  assert.equal(store.get().status.line, '/compact does not accept attachments');
  assert.equal(say.value, '/compact');
  assert.match(f.html(), /prices.csv/);
  store.timers.clear();
});

test('a command that finds its receipt gone uploads again once and runs once more', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  executing(h, n => (n === 1 ? { result: { kind: 'error', text: 'File upload receipt is unknown for this session.' } } : { result: { kind: 'ok', text: 'goal set' } }));
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [CSV()]);
  att.uploads[0].answer('rcpt-1');
  await settle();
  type(f, say, '/goal read it');
  send(f);
  await settle();
  assert.equal(att.uploads.length, 2);
  att.uploads[1].answer('rcpt-2');
  await settle();
  assert.deepEqual(execsOf(h).map(e => e.submittedAttachments), [[{ type: 'file', receiptId: 'rcpt-1' }], [{ type: 'file', receiptId: 'rcpt-2' }]]);
  assert.equal(say.value, '');
  assert.equal(store.get().status.line, 'goal set');
  store.timers.clear();
});

test('a second Enter during a slow image read sends nothing more; a failed read keeps the draft', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = await bootFiles(f, h, fakeAttachments());
  let release;
  const read = new Promise(r => { release = () => r(new Uint8Array(PNG_BYTES).buffer); });
  const slow = { ...pngFile(), arrayBuffer: () => read };
  pick(f, input, [slow]);
  type(f, say, 'look');
  send(f);
  send(f);
  await settle();
  release();
  await settle();
  assert.equal(promptsOf(h).length, 1, 'one send');
  const broken = { ...pngFile('broken.png'), arrayBuffer: async () => { throw new Error('gone'); } };
  pick(f, input, [broken]);
  type(f, say, 'again');
  send(f);
  await settle();
  assert.equal(promptsOf(h).length, 1);
  assert.equal(store.get().status.line, 'send: broken.png could not be read');
  assert.equal(say.value, 'again');
  assert.match(f.html(), /broken.png/);
  store.timers.clear();
});

test('removing one of two refused images keeps the model line', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  prompting(h, () => attachmentInvalid('MODEL_DOES_NOT_SUPPORT_IMAGES'));
  const store = await bootFiles(f, h, fakeAttachments());
  pick(f, input, [pngFile(), pngFile('second.png')]);
  send(f);
  await settle();
  assert.match(f.html(), MODEL_LINE);
  const key = f.html().match(/data-action="attachRemove" data-key="(a\d+)"/)[1];
  f.click({ tagName: 'BUTTON', dataset: { action: 'attachRemove', key } });
  assert.match(f.html(), MODEL_LINE, 'an image remains');
  store.timers.clear();
});

test('a restage that ends off screen says the files are up and the message was not sent', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = twoRows();
  prompting(h, n => (n === 1 ? attachmentInvalid('FILE_NOT_STAGED') : undefined));
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  pick(f, input, [CSV()]);
  att.uploads[0].answer('rcpt-1');
  await settle();
  type(f, say, 'read it');
  send(f);
  await settle();
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  att.uploads[1].answer('rcpt-2');
  await settle();
  assert.equal(promptsOf(h).length, 1, 'not sent again off screen');
  assert.equal(store.get().status.line, 'Files uploaded again; the message was not sent');
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.equal(say.value, 'read it');
  assert.match(f.html(), /prices.csv/);
  store.timers.clear();
});

test('New message refused for its image keeps a chip and a file beside it', async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  prompting(h, () => attachmentInvalid('MODEL_DOES_NOT_SUPPORT_IMAGES'));
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att, runsEditor);
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  const draft = [{ type: 'text', text: 'compare ' }, { type: 'chip', chip: fileChip }];
  putRuns(f, say, draft);
  pick(f, input, [CSV(), pngFile()]);
  send(f);
  await settle();
  att.uploads[0].answer('rcpt-1');
  await settle();
  assert.equal(promptsOf(h).length, 1);
  assert.equal(store.get().route.id, 's-new');
  store.dispatch('toggleRail');
  assert.deepEqual(say.runs, draft, 'the words and the chip');
  assert.match(f.html(), /prices.csv/, 'the file');
  assert.match(f.html(), /alt="chart.png"/, 'the image');
  assert.match(f.html(), MODEL_LINE);
  store.timers.clear();
});

// ---- thumbnails and the lightbox in the page (plan 4 task 7) ----
const IMG = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 1258291, width: 800, height: 600, name: 'chart.png' };
const imagePage = (attachments = [{ type: 'image', attachment: IMG }]) => [{ type: 'event', event: { type: 'user/message', seq: 7, time: 1, surfaceOp: 'append', data: { id: 'm7', role: 'user', content: [{ type: 'text', text: 'see this' }, ...attachments], source: { kind: 'user' } } } }];
// a host whose s1 holds an operator image; session/attachment answers as `answer` says, each read counted
function imageHost(answer = () => ({ attachment: { mediaType: 'image/png' }, data: 'iVBORw0KGgo=' }), attachments) {
  const h = host({ rows: [row('s1'), row('s2', { updatedAt: 1 })], pages: { s1: imagePage(attachments) } });
  const call = h.call;
  h.thumbReads = [];
  h.call = async (endpoint, args) => {
    if (endpoint === 'session/attachment') { h.calls.push([endpoint, args]); h.thumbReads.push(args.request); return answer(args.request); }
    return call(endpoint, args);
  };
  return h;
}
const THUMB = 'blob:fake';   // the fake window's every object URL
const imageKey = '[data-action="openImage"][data-attachment="att-1"][data-name="chart.png"]';
const lightboxRig = async (h = imageHost(), clock = null) => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const image = f.withSelector(imageKey, { tagName: 'BUTTON', dataset: { action: 'openImage', attachment: 'att-1', name: 'chart.png' }, presentIf: /data-action="openImage"/ });
  const close = f.withSelector('.lightbox-close', { tagName: 'BUTTON', dataset: { action: 'lightboxClose' }, presentIf: /class="lightbox"/ });
  const store = clock
    ? boot(f.win, { editor: valueEditor, openMux: h.openMux, call: h.call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, now: () => clock.t })
    : started(f, h);
  await h.ready();
  await settle();
  return { f, h, store, image, close };
};

test('a conversation with an image reads its thumb once and draws it when it lands', async () => {
  let landing;
  const h = imageHost(() => new Promise(r => { landing = r; }));
  const { f, store } = await lightboxRig(h);
  assert.deepEqual(h.thumbReads, [{ sessionId: 's1', attachmentId: 'att-1' }]);
  assert.match(f.html(), /class="you-image loading"/, 'a frame while it reads');
  store.dispatch('toggleRail'); store.dispatch('toggleRail');   // renders while the read is in the air ask nothing more
  assert.equal(h.thumbReads.length, 1);
  landing({ attachment: { mediaType: 'image/png' }, data: 'iVBORw0KGgo=' });
  await settle();
  assert.match(f.html(), new RegExp(`<img src="${THUMB.replace(/[+/]/g, '\\$&')}" alt="chart.png">`));
  assert.equal(store.get().thumbs['att-1'], THUMB);
  store.dispatch('toggleRail');
  assert.equal(h.thumbReads.length, 1, 'a landed thumb is not asked again');
  store.timers.clear();
});

test('an image that cannot be read draws its card, and is not asked again', async () => {
  const h = imageHost(() => { throw Object.assign(new Error('gone'), { code: 'session/attachment-not-found' }); });
  const { f, store } = await lightboxRig(h);
  assert.equal(store.get().thumbs['att-1'], null);
  assert.match(f.html(), /file-name">chart.png</);
  assert.doesNotMatch(f.html(), /data-action="openImage"/);
  store.dispatch('toggleRail'); store.dispatch('toggleRail');
  assert.equal(h.thumbReads.length, 1);
  store.timers.clear();
});

test('an attachment id named like a prototype key is read and drawn as its own', async () => {
  const h = imageHost(undefined, [{ type: 'image', attachment: { ...IMG, attachmentId: 'constructor' } }]);
  const { f, store } = await lightboxRig(h);
  assert.deepEqual(h.thumbReads, [{ sessionId: 's1', attachmentId: 'constructor' }], 'Object.prototype.constructor is not a thumb');
  assert.match(f.html(), /<img src="blob:fake"/);
  store.timers.clear();
});

test('a click on a thumb opens the lightbox; a click on the image keeps it; the backdrop and × close it', async () => {
  const { f, store, image, close } = await lightboxRig();
  image.focus();
  f.click(image);
  assert.deepEqual(store.get().lightbox, { attachmentId: 'att-1', name: 'chart.png' });
  assert.match(f.html(), /class="lightbox" role="dialog" aria-modal="true" aria-label="Image"/);
  assert.match(f.html(), /class="lightbox-img" src="blob:fake" alt="chart.png"/);
  assert.equal(f.doc.activeElement, close, 'focus moves to its close key');
  // focus stays inside: Tab and Shift+Tab land on the close key, and a render keeps it there
  let prevented = false;
  f.body.focus();
  f.fire('doc', 'keydown', { key: 'Tab', target: f.body, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.doc.activeElement, close);
  store.dispatch('toggleRail');
  assert.equal(f.doc.activeElement, close, 'a render keeps focus in the lightbox');
  f.click({ tagName: 'IMG', dataset: { action: 'lightboxKeep' } });
  assert.ok(store.get().lightbox, 'a click on the image keeps it');
  f.click({ tagName: 'DIV', dataset: { action: 'lightboxClose' } });
  assert.equal(store.get().lightbox, null, 'the backdrop closes it');
  assert.doesNotMatch(f.html(), /class="lightbox"/);
  assert.equal(f.doc.activeElement, image, 'focus returns to the image');
  f.click(image);
  f.click(close);
  assert.equal(store.get().lightbox, null, '× closes it');
  store.timers.clear();
});

test('a thumb still loading, or one the host could not give, opens nothing', async () => {
  const h = imageHost(() => new Promise(() => {}));
  const { f, store } = await lightboxRig(h);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openImage', attachment: 'att-1', name: 'chart.png' } });
  assert.equal(store.get().lightbox, null, 'a loading frame opens nothing');
  store.dispatch('hostThumb', { attachmentId: 'att-1', src: 'https://example.com/x.png' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'openImage', attachment: 'att-1', name: 'chart.png' } });
  assert.equal(store.get().lightbox, null, 'nor a src that is not an image\'s');
  store.timers.clear();
});

test('Esc closes the lightbox before Details, and a menu before the lightbox', async () => {
  const { f, store, image } = await lightboxRig();
  f.click({ tagName: 'BUTTON', dataset: { action: 'toggleDetails' } });
  f.click(image);
  assert.ok(store.get().lightbox);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().lightbox, null, 'the lightbox first');
  assert.equal(store.get().detailsOpen, true, 'Details stays');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().detailsOpen, false);
  store.timers.clear();

  // a menu showing rows in the editor closes before the lightbox
  const { f: g, say, slot, store: st } = await menuRig();
  st.dispatch('hostThumb', { attachmentId: 'att-9', src: THUMB });
  typeMenu(g, say, '@');
  await settle();
  assert.notEqual(slot.innerHTML, '');
  st.dispatch('openLightbox', { attachmentId: 'att-9', name: 'x.png' });
  press(g, say, 'Escape');
  assert.equal(slot.innerHTML, '', 'the menu closes');
  assert.ok(st.get().lightbox, 'the lightbox stays');
  press(g, say, 'Escape');
  assert.equal(st.get().lightbox, null);
  st.timers.clear();
});

test('Esc closes the lightbox before the search box', async () => {
  const { f, store, image } = await lightboxRig();
  const cq = f.withId('cq', { tagName: 'INPUT' });
  f.click(image);
  cq.focus();
  cq.value = 'eth';
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().lightbox, null);
  assert.equal(cq.value, 'eth', 'the search box keeps its words');
  store.timers.clear();
});

test('leaving the conversation closes the lightbox', async () => {
  const { f, store, image } = await lightboxRig();
  f.click(image);
  assert.ok(store.get().lightbox);
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  assert.equal(store.get().route.id, 's2');
  assert.equal(store.get().lightbox, null);
  assert.doesNotMatch(f.html(), /class="lightbox"/);
  store.timers.clear();
});

// the review round (plan 4 task 7): a failing thumb read backs off across renders; a fence stops reads until the reconnect
test('a thumb read failing on the carrier is not asked again on every render, only once the backoff passes', async () => {
  const clock = { t: Date.now() };
  const h = imageHost(() => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); });
  const { store } = await lightboxRig(h, clock);
  assert.equal(h.thumbReads.length, 1);
  for (let i = 0; i < 20; i++) store.dispatch('toggleRail');
  await settle();
  assert.equal(h.thumbReads.length, 1, 'twenty renders, no read more');
  clock.t += 2000;
  store.dispatch('toggleRail');
  await settle();
  assert.equal(h.thumbReads.length, 2, 'the render after the backoff reads again');
  store.timers.clear();
});

test('a thumb read refused 404 draws the card; one fenced 401 waits for the reconnect', async () => {
  const { f: f1, h: h1, store: s1 } = await lightboxRig(imageHost(() => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); }));
  assert.equal(s1.get().thumbs['att-1'], null);
  assert.match(f1.html(), /file-name">chart.png</);
  assert.equal(h1.thumbReads.length, 1);
  s1.timers.clear();

  const clock = { t: Date.now() };
  let fenced = true;
  const h = imageHost(() => { if (fenced) throw Object.assign(new Error('HTTP 401'), { status: 401 }); return { attachment: { mediaType: 'image/png' }, data: 'iVBORw0KGgo=' }; });
  const { f, store } = await lightboxRig(h, clock);
  assert.equal(h.thumbReads.length, 1);
  clock.t += 120000;
  store.dispatch('toggleRail');
  await settle();
  assert.equal(h.thumbReads.length, 1, 'no read while fenced, however long');
  fenced = false;
  h.opts().onDown('socket closed');
  await h.ready();
  await settle();
  assert.equal(h.thumbReads.length, 2, 'the reconnect reads it again');
  assert.match(f.html(), /<img src="blob:fake" alt="chart.png">/);
  store.timers.clear();
});

test('⌥⌘K does nothing while the lightbox is open', async () => {
  const { f, store, image, close } = await lightboxRig();
  const cq = f.withId('cq', { tagName: 'INPUT' });
  f.click(image);
  let prevented = false;
  f.fire('doc', 'keydown', keyK({ ctrlKey: true }, () => { prevented = true; }));
  assert.equal(prevented, true, 'the browser does not take the keys either');
  assert.notEqual(f.doc.activeElement, cq, 'the search box does not take focus');
  assert.equal(f.doc.activeElement, close);
  assert.ok(store.get().lightbox, 'the lightbox stays');
  store.timers.clear();
});

test('focus returns to the image clicked, though the click did not focus it (Safari)', async () => {
  const { f, store, image, close } = await lightboxRig();
  const say = f.withId('say', { tagName: 'INPUT' });
  say.focus();
  f.click(image);
  assert.equal(f.doc.activeElement, close);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(f.doc.activeElement, image, 'back on the image, not the editor that had focus');
  store.timers.clear();
});

test('a send from the empty state (no conversation, no New message) says to open one first and keeps the draft', async () => {
  const f = fakeWindow({ hash: '#/messages' });
  const { say, input } = composerEls(f);
  const h = host({ rows: [] });
  const att = fakeAttachments();
  const store = await bootFiles(f, h, att);
  assert.equal(store.get().route.id ?? null, null, 'the empty state');
  type(f, say, 'hello');
  send(f);
  await settle();
  assert.match(f.html(), /status-line bad" role="status">Open a conversation first</);
  assert.equal(say.value, 'hello', 'the words are kept');
  pick(f, input, [CSV()]);
  type(f, say, '');
  send(f);
  await settle();
  assert.match(f.html(), /status-line bad" role="status">Open a conversation first</, 'files alone too');
  assert.match(f.html(), /file-name">prices.csv</, 'the file is kept');
  assert.deepEqual(promptsOf(h), []);
  assert.equal(att.uploads.length, 0, 'nothing uploads from the empty state');
  store.timers.clear();
});

// ---- masking on screen (plan 5 task 2): the eye in the operator's bubble ----
const SK = 'sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4';
const keyPage = [{ type: 'event', event: { type: 'user/message', seq: 7, time: 1, surfaceOp: 'append', data: { id: 'm7', role: 'user', content: [{ type: 'text', text: `my key ${SK}` }], source: { kind: 'user' } } } }];
const secretRig = async () => {
  const f = fakeWindow({ hash: '#/messages/s1' });
  const eye = f.withId('secret-e7-0', { tagName: 'BUTTON', dataset: { action: 'toggleSecret', secret: 'e7-0' }, presentIf: /id="secret-e7-0"/ });
  const h = host({ rows: [row('s1'), row('s2', { updatedAt: 1 })], pages: { s1: keyPage, s2: [] } });
  const store = started(f, h);
  await h.ready();
  await settle();
  return { f, h, store, eye };
};

test('Show secret reveals the value, a render keeps it, and opening another conversation masks it again', async () => {
  const { f, store, eye } = await secretRig();
  assert.match(f.html(), /<span class="secret" data-secret="e7-0">/);
  assert.match(f.html(), /aria-label="Show secret"/);
  f.click(eye);
  await settle();
  assert.match(f.html(), /<span class="secret revealed" data-secret="e7-0"><span class="secret-raw">sk-proj-/);
  assert.match(f.html(), /aria-label="Hide secret"/);
  assert.doesNotMatch(f.html(), /secret-mask/);
  store.dispatch('toggleRail');
  assert.match(f.html(), /secret revealed/, 'a render keeps it');
  f.click(eye);
  await settle();
  assert.match(f.html(), /<span class="secret" data-secret="e7-0">/, 'the eye hides it again');
  f.click(eye);
  await settle();
  assert.match(f.html(), /secret revealed/);
  f.win.location.hash = '#/messages/s2';
  f.fire('win', 'hashchange');
  await settle();
  f.win.location.hash = '#/messages/s1';
  f.fire('win', 'hashchange');
  await settle();
  assert.match(f.html(), /<span class="secret" data-secret="e7-0">/, 'back on s1 it is masked again');
  assert.doesNotMatch(f.html(), /secret revealed/);
  store.timers.clear();
});

test('the eye keeps focus as its label flips', async () => {
  const { f, store, eye } = await secretRig();
  eye.focus();
  f.click(eye);
  await settle();
  assert.match(f.html(), /aria-label="Hide secret"/);
  assert.equal(f.doc.activeElement, eye);
  f.click(eye);
  await settle();
  assert.match(f.html(), /aria-label="Show secret"/);
  assert.equal(f.doc.activeElement, eye);
  store.timers.clear();
});

test('a pill opens Details scrolled to Usage', async () => {
  const f = fakeWindow({ hash: '' });
  const scrolled = [];
  const drawer = f.withSelector('.drawer-body', { presentIf: /class="drawer details"/ });
  f.withId('dsec-usage', { presentIf: /id="dsec-usage"/, scrollIntoView(o) { scrolled.push({ o, drawerTop: drawer.scrollTop }); } });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = started(f, h);
  await h.ready();
  h.streams[0].cbs.onItem({ type: 'projection', sessionId: 's1', key: 'sessionStats', value: { turns: 2, steps: 5, llmMs: 9000, toolMs: 0, ttftMs: 2000, ttftSteps: 5, decodeMs: 0, decodeTokens: 0 }, seq: 4 });
  await settle();
  assert.match(f.html(), /<button type="button" class="stats-pill" id="pill-figures-s1" data-action="openUsage" aria-label="2 turns · 5 steps, open Usage">2 turns · 5 steps<\/button>/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openUsage' } });
  await settle();
  assert.equal(store.get().detailsOpen, true);
  assert.deepEqual(scrolled.map(x => x.o), [{ block: 'start' }], 'Usage scrolled into view once');
  // a second press leaves Details open and scrolls to Usage again; a render in between scrolls nothing
  store.dispatch('hostStatus', { line: 'x' });
  await settle();
  assert.equal(scrolled.length, 1, 'the scroll is for the press, not every render');
  drawer.scrollTop = 300;   // the reader scrolled the drawer: its own keep runs first, then the scroll to Usage
  f.click({ tagName: 'BUTTON', dataset: { action: 'openUsage' } });
  await settle();
  assert.equal(store.get().detailsOpen, true, 'never closed by a pill');
  assert.equal(scrolled.length, 2);
  assert.equal(scrolled[1].drawerTop, 300, "the drawer's keep ran before scrollIntoView");
  store.timers.clear();
});

test('each pill keeps its own focus: pill 2 stays focused across a render, and Esc from Details returns to it', async () => {
  const f = fakeWindow({ hash: '' });
  const pill1 = f.withId('pill-figures-s1', { tagName: 'BUTTON', dataset: { action: 'openUsage' }, presentIf: /id="pill-figures-s1"/ });
  const pill2 = f.withId('pill-tokens-s1', { tagName: 'BUTTON', dataset: { action: 'openUsage' }, presentIf: /id="pill-tokens-s1"/ });
  const close = f.withSelector('.drawer .close-key', { tagName: 'BUTTON', presentIf: /class="drawer details"/ });
  const h = host({ rows: [row('s1', { agentAvailable: true })] });
  const store = started(f, h);
  await h.ready();
  h.streams[0].cbs.onItem({ type: 'projection', sessionId: 's1', key: 'sessionStats', value: { turns: 2, steps: 5, llmMs: 9000, toolMs: 0, ttftMs: 2000, ttftSteps: 5, decodeMs: 0, decodeTokens: 0 }, seq: 4 });
  h.streams[0].cbs.onItem({ type: 'projection', sessionId: 's1', key: 'tokenUsage', value: { uncachedInputTokens: 900, cacheReadTokens: 100, outputTokens: 50 }, seq: 5 });
  await settle();
  assert.match(f.html(), /id="pill-tokens-s1" data-action="openUsage" aria-label="1.1k tokens · cache 10%, open Usage">1.1k tokens · cache 10%</);
  pill2.focus();
  store.dispatch('hostStatus', { line: 'a stream frame' });
  await settle();
  assert.equal(f.doc.activeElement, pill2, 'a render keeps focus on pill 2, not pill 1');
  f.click(pill2);
  await settle();
  assert.equal(f.doc.activeElement, close);
  f.fire('doc', 'keydown', { key: 'Escape' });
  await settle();
  assert.equal(store.get().detailsOpen, false);
  assert.equal(f.doc.activeElement, pill2, 'focus back on the pill that opened Details');
  assert.notEqual(f.doc.activeElement, pill1);
  store.timers.clear();
});

// ---- the turn rail (plan 5, Task 7)
// s1's snapshot holds 30 and 32 with more before it; turn 1 starts at 9 (paged in two pages back), turn 2 at 29 (its prompt,
// 30, drawn though its turn/start lies before the window), turn 3 at 31. Each mark is registered by its id and as a
// .turn-mark, found while its id is drawn, with a fixed offsetTop and its scrollIntoView calls recorded
const outline = [{ turn: 1, seq: 9, prompt: 'first ask', response: 'first reply' }, { turn: 2, seq: 29, prompt: 'second ask', response: '' }, { turn: 3, seq: 31, prompt: 'third ask', response: 'third reply' }];
function railRig({ pages, rows = [row('s1', { agentAvailable: true })], turns = outline } = {}) {
  const f = fakeWindow({ hash: '' });
  const thread = f.withId('thread', { clientHeight: 400 });
  // #turn-rail as the browser has it: what the page last drew in it, until the rail alone is written after that render
  const rail = f.withId('turn-rail');
  // (a write replaces its nodes, so focus falls to <body>, as the page's own render does)
  let own = null;
  rail.writes = 0;
  Object.defineProperty(rail, 'innerHTML', {
    get: () => (own && own.at === f.writes ? own.html : f.html().match(/<nav class="turn-rail" id="turn-rail" aria-label="Turns" role="toolbar" aria-orientation="vertical">([\s\S]*?)<\/nav>/)?.[1] ?? ''),
    // (afterWrite, when a test sets it, sees the element that had focus before the write)
    set: html => { const was = f.doc.activeElement; own = { at: f.writes, html }; rail.writes++; f.doc.activeElement = f.body; rail.afterWrite?.(was); },
  });
  const marks = {};
  for (const [turn, top] of [[1, 0], [2, 100], [3, 500]]) {
    const el = f.withId(`tmark-s1-${turn}`, { dataset: { turn: String(turn) }, offsetTop: top, presentIf: new RegExp(`id="tmark-s1-${turn}"`), scrolled: [] });
    // (an instant scroll lands at once, as the browser's does; a smooth one would still be gliding at the next render)
    el.scrollIntoView = o => { el.scrolled.push({ ...o, drawn: f.html().includes(`id="tmark-s1-${turn}"`) }); if (o?.behavior !== 'smooth') thread.scrollTop = el.offsetTop; };
    f.alsoAs('.turn-mark', el);
    marks[turn] = el;
  }
  const book = { 30: { records: [said(10), said(11)], hasMore: true }, 10: { records: [said(2), said(3)], hasMore: false } };
  const h = host({ rows, pages: { s1: pages ?? (req => book[req.beforeSeq] ?? { records: [], hasMore: false }) } });
  const snap = async () => {
    h.streams.find(s => s.name === 'session/follow' && s.args.request.address.sessionId === 's1').cbs.onItem({ type: 'snapshot', header: {}, cursor: 40, hasMore: true, records: [said(30), said(32)], projections: { asOfSeq: 40, values: { turnOutline: turns } } });
    await settle();
  };
  return { f, thread, rail, marks, h, book, snap };
}
const tickEl = turn => ({ id: `turn-tick-${turn}`, dataset: { action: 'jumpTurn', turn: String(turn) }, closest: sel => (sel === '.turn-tick' ? tickEl(turn) : null) });
const wait = ms => new Promise(r => setTimeout(r, ms));

test('a scroll redraws the rail alone with the active turn, and the page is not rendered', async () => {
  const { f, thread, rail, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  assert.match(f.html(), /<div class="turn-mark" id="tmark-s1-2" data-turn="2"><\/div>/);
  assert.match(rail.innerHTML, /class="turn-tick loaded active" id="turn-tick-3"/, 'at the tail, the last turn');
  const writes = f.writes;
  thread.scrollTop = 150;
  f.fire('root', 'scroll', { target: thread });
  f.fire('root', 'scroll', { target: thread });
  await wait(100);
  assert.equal(f.writes, writes, 'the page is not rendered');
  assert.match(rail.innerHTML, /class="turn-tick active" id="turn-tick-2"/);
  assert.doesNotMatch(rail.innerHTML, /active" id="turn-tick-3"/);
  store.timers.clear();
});

test('hovering a tick draws its card in the rail alone', async () => {
  const { f, rail, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  const writes = f.writes;
  f.fire('root', 'mouseover', { target: tickEl(1) });
  assert.match(rail.innerHTML, /id="turn-tick-1"[^>]*><\/button><div class="turn-card" id="turn-card-1" role="tooltip"><div class="turn-card-head">Turn 1 · jump<\/div><div class="turn-card-prompt">first ask<\/div><div class="turn-card-reply">first reply<\/div><\/div>/);
  f.fire('root', 'mouseover', { target: tickEl(2) });
  assert.match(rail.innerHTML, /Turn 2 · jump/);
  assert.doesNotMatch(rail.innerHTML, /Turn 1 · jump/);
  f.fire('root', 'mouseout', { target: tickEl(2), relatedTarget: { closest: () => null } });
  assert.doesNotMatch(rail.innerHTML, /turn-card/, 'leaving the rail clears the card');
  f.fire('root', 'focusin', { target: tickEl(3) });
  assert.match(rail.innerHTML, /Turn 3 · jump/, 'a focused tick shows its card');
  assert.equal(f.writes, writes, 'the page is not rendered');
  store.timers.clear();
});

test('a loaded tick scrolls its mark into view', async () => {
  const { f, marks, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  f.click({ tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: '3' } });
  assert.deepEqual(marks[3].scrolled, [{ block: 'start', drawn: true }]);
  // turn 2 reads unloaded (its turn/start precedes the window) but its mark is drawn: the mark wins, nothing is paged
  f.click({ tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: '2' } });
  assert.equal(marks[2].scrolled.length, 1);
  await settle();
  assert.deepEqual(earlierPages(h), []);
  store.timers.clear();
});

test('an unloaded tick pulses, pages back to it and scrolls to its mark once drawn', async () => {
  const { f, rail, marks, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  f.click({ tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: '1' } });
  assert.match(rail.innerHTML, /class="turn-tick pulse" id="turn-tick-1"/);
  await settle();
  assert.deepEqual(earlierPages(h), [30, 10], 'paged back through turn 1\'s seq');
  assert.match(f.html(), /<div class="turn-mark" id="tmark-s1-1" data-turn="1"><\/div>[\s\S]*said 10/);
  assert.deepEqual(marks[1].scrolled, [{ block: 'start', drawn: true }]);
  assert.doesNotMatch(rail.innerHTML, /pulse/);
  h.streams.find(s => s.name === 'session/follow').cbs.onItem({ type: 'event', event: said(41).event });
  await settle();
  assert.match(f.html(), /said 41/);
  assert.doesNotMatch(f.html(), /turn-tick[^"]*pulse/, 'the next render draws no pulse either');
  assert.equal(marks[1].scrolled.length, 1, 'and jumps no more');
  store.timers.clear();
});

test('a jump lands at once, and the next stream render keeps the place it jumped to', async () => {
  const { f, thread, marks, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  assert.equal(thread.scrollTop, thread.scrollHeight, 'at the tail');
  f.click({ tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: '2' } });
  assert.equal(thread.scrollTop, 100, "turn 2's mark at the top");
  h.streams.find(s => s.name === 'session/follow').cbs.onItem({ type: 'event', event: said(41).event });
  await settle();
  assert.match(f.html(), /said 41/);
  assert.equal(thread.scrollTop, 100, 'the render keeps the jumped place, not the tail');
  assert.equal(marks[2].scrolled.length, 1);
  store.timers.clear();
});

test("a tick's focusout from a render removing it keeps the card", async () => {
  const { f, rail, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  f.fire('root', 'focusin', { target: tickEl(1) });
  assert.match(rail.innerHTML, /Turn 1 · jump/);
  // Chrome fires focusout on the focused tick a page write took out of the document
  f.fire('root', 'focusout', { target: { ...tickEl(1), isConnected: false }, relatedTarget: null });
  assert.match(rail.innerHTML, /Turn 1 · jump/, 'a disconnected target is not the focus leaving');
  f.fire('root', 'focusout', { target: { ...tickEl(1), isConnected: true }, relatedTarget: null });
  assert.doesNotMatch(rail.innerHTML, /turn-card/, 'a connected one is');
  store.timers.clear();
});

test('a turn starting with the reader at the tail drops the earlier pages; read up, it keeps them', async () => {
  const { f, thread, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  const fl = () => h.streams.find(s => s.name === 'session/follow').cbs;
  f.click({ tagName: 'BUTTON', dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  assert.match(f.html(), /said 10/);
  thread.scrollTop = 100;   // read up
  fl().onItem({ type: 'event', event: { type: 'turn/start', seq: 41, time: 1, data: { turn: 4 } } });
  await settle();
  assert.match(f.html(), /said 10/, 'kept while reading up');
  thread.scrollTop = thread.scrollHeight - thread.clientHeight;   // back at the tail
  fl().onItem({ type: 'event', event: { type: 'turn/start', seq: 42, time: 1, data: { turn: 5 } } });
  await settle();
  assert.doesNotMatch(f.html(), /said 10/, 'dropped at the tail');
  assert.match(f.html(), /said 30/);
  assert.equal(store.get().conversations.find(c => c.id === 's1').window.hasMore, true);
  assert.match(f.html(), /Earlier messages/);
  store.timers.clear();
});

test('an unloaded tick whose read fails stops pulsing', async () => {
  const { f, rail, h, snap } = railRig({ pages: async () => { throw Object.assign(new Error('x'), { code: 'BOOM' }); } });
  const store = started(f, h);
  await h.ready();
  await snap();
  f.click({ tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: '1' } });
  assert.match(rail.innerHTML, /pulse/);
  await settle();
  assert.doesNotMatch(rail.innerHTML, /pulse/);
  assert.match(f.html(), /status-line bad" role="status">earlier: BOOM</);
  h.streams.find(s => s.name === 'session/follow').cbs.onItem({ type: 'event', event: said(41).event });
  await settle();
  assert.doesNotMatch(f.html(), /turn-tick[^"]*pulse/);
  store.timers.clear();
});

test('a conversation opened while the pages load clears the pulse and the jump', async () => {
  const waits = [];
  const { f, thread, rail, marks, h, book, snap } = railRig({ rows: [row('s1', { agentAvailable: true }), row('s2', { agentAvailable: true, updatedAt: 4 })], pages: req => new Promise(r => waits.push(() => r(book[req.beforeSeq]))) });
  const store = started(f, h);
  await h.ready();
  await snap();
  f.click({ tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: '1' } });
  await settle();
  assert.match(rail.innerHTML, /pulse/);
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's2' } });
  await settle();
  h.streams.filter(s => s.name === 'session/follow' && s.args.request.address.sessionId === 's2').at(-1).cbs.onItem({ type: 'snapshot', header: {}, cursor: 9, hasMore: false, records: [said(5)], projections: { asOfSeq: 9, values: {} } });
  await settle();
  while (waits.length) { waits.shift()(); await settle(); }
  assert.equal(store.get().route.id, 's2');
  assert.doesNotMatch(f.html(), /pulse/);
  assert.doesNotMatch(rail.innerHTML, /pulse/);
  assert.equal(marks[1].scrolled.length, 0, 'no jump on the other conversation');
  assert.equal(store.get().conversations.find(c => c.id === 's1').messages.some(m => m.seq === 10), false, 'nothing prepended to s1');
  assert.equal(store.get().conversations.find(c => c.id === 's2').messages.some(m => m.seq === 10), false, 'nor to s2');
  assert.equal(thread.scrollTop, thread.scrollHeight, "s2's thread at its tail");
  // back on s1: the rail starts afresh, no pulse
  f.click({ tagName: 'A', dataset: { action: 'open', id: 's1' } });
  await settle();
  assert.doesNotMatch(f.html(), /pulse/);
  store.timers.clear();
});

// fix round 1 of Task 7
// a tick the page can focus: found while drawn, its focus firing focusin as the browser's does
function focusableTick(f, turn) {
  const el = f.withId(`turn-tick-${turn}`, { tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: String(turn) }, presentIf: new RegExp(`id="turn-tick-${turn}"`) });
  el.closestMap = { '.turn-tick': el };
  el.focus = o => { f.doc.activeElement = el; el.focusedWith = o; f.fire('root', 'focusin', { target: el }); };
  return el;
}

test("a render's own focus restore on a tick shows no card: the card stays hidden after the pointer left", async () => {
  const { f, rail, h, snap } = railRig();
  const tick = focusableTick(f, 1);
  const store = started(f, h);
  await h.ready();
  await snap();
  tick.focus();
  assert.match(rail.innerHTML, /Turn 1 · jump/);
  f.fire('root', 'mouseout', { target: tick, relatedTarget: { closest: () => null } });
  assert.doesNotMatch(rail.innerHTML, /turn-card/);
  const writes = rail.writes;
  h.streams.find(s => s.name === 'session/follow').cbs.onItem({ type: 'event', event: said(41).event });
  await settle();
  assert.match(f.html(), /said 41/);
  assert.equal(f.doc.activeElement, tick, 'the tick keeps focus across the render');
  assert.doesNotMatch(rail.innerHTML, /turn-card/, 'no card brought back');
  assert.equal(rail.writes, writes, 'the rail is not written again');
  store.timers.clear();
});

test('a focused tick keeps focus across the rail\'s own redraw', async () => {
  const { f, thread, rail, h, snap } = railRig();
  const tick = focusableTick(f, 2);
  const store = started(f, h);
  await h.ready();
  await snap();
  tick.focus();
  const writes = rail.writes;
  thread.scrollTop = 150;
  f.fire('root', 'scroll', { target: thread });
  await wait(100);
  assert.ok(rail.writes > writes, 'redrawn');
  assert.equal(f.doc.activeElement, tick);
  assert.equal(tick.focusedWith?.preventScroll, true);
  store.timers.clear();
});

// plan 6, Task 11: the rail one Tab stop, its ticks walked with the arrows, Home and End
const keyOn = (f, target, key) => {
  let prevented = false;
  f.fire('doc', 'keydown', { key, code: key, target, preventDefault() { prevented = true; } });
  return prevented;
};

test('↓ on a tick focuses the next one and shows its card; Home and End go to the ends', async () => {
  const { f, rail, h, snap } = railRig();
  const ticks = { 1: focusableTick(f, 1), 2: focusableTick(f, 2), 3: focusableTick(f, 3) };
  const store = started(f, h);
  await h.ready();
  await snap();
  ticks[1].focus();
  assert.match(rail.innerHTML, /Turn 1 · jump/);
  const writes = f.writes;
  let drawn = rail.writes;
  assert.equal(keyOn(f, ticks[1], 'ArrowDown'), true, 'the arrow is the rail\'s');
  assert.equal(f.doc.activeElement, ticks[2]);
  assert.equal(rail.writes, drawn + 1, 'the rail redrawn once');
  assert.match(rail.innerHTML, /id="turn-tick-2"[^>]*tabindex="0"[^>]*aria-describedby="turn-card-2"[^>]*><\/button><div class="turn-card" id="turn-card-2" role="tooltip"><div class="turn-card-head">Turn 2 · jump/);
  assert.match(rail.innerHTML, /id="turn-tick-1"[^>]*tabindex="-1"/);
  assert.doesNotMatch(rail.innerHTML, /Turn 1 · jump/);
  keyOn(f, ticks[2], 'ArrowUp');
  assert.equal(f.doc.activeElement, ticks[1]);
  assert.match(rail.innerHTML, /Turn 1 · jump/);
  drawn = rail.writes;
  keyOn(f, ticks[1], 'ArrowUp');
  assert.equal(f.doc.activeElement, ticks[1], '↑ on the first stays');
  assert.equal(rail.writes, drawn, 'and draws nothing');
  keyOn(f, ticks[1], 'End');
  assert.equal(f.doc.activeElement, ticks[3]);
  assert.match(rail.innerHTML, /Turn 3 · jump/);
  keyOn(f, ticks[3], 'Home');
  assert.equal(f.doc.activeElement, ticks[1]);
  assert.match(rail.innerHTML, /id="turn-tick-1"[^>]*tabindex="0"/);
  assert.equal(f.writes, writes, 'the page is not rendered');
  // the page's own render keeps the focused tick as the rail's one stop
  h.streams.find(s => s.name === 'session/follow').cbs.onItem({ type: 'event', event: said(41).event });
  await settle();
  assert.match(f.html(), /said 41/);
  assert.match(f.html(), /id="turn-tick-1"[^>]*tabindex="0"/);
  store.timers.clear();
});

test("an arrow's redraw removes the focused tick and its focusout hides no card", async () => {
  const { f, rail, h, snap } = railRig();
  const ticks = { 1: focusableTick(f, 1), 2: focusableTick(f, 2), 3: focusableTick(f, 3) };
  // as Chrome does: the write takes the focused tick out of the document, and it fires focusout as it goes
  rail.afterWrite = was => {
    if (was?.id?.startsWith('turn-tick-')) f.fire('root', 'focusout', { target: { ...tickEl(Number(was.dataset.turn)), isConnected: false }, relatedTarget: null });
  };
  const store = started(f, h);
  await h.ready();
  await snap();
  ticks[1].focus();
  const drawn = rail.writes;
  keyOn(f, ticks[1], 'ArrowDown');
  assert.equal(f.doc.activeElement, ticks[2]);
  assert.match(rail.innerHTML, /Turn 2 · jump/, 'the card stays');
  assert.equal(rail.writes, drawn + 1, 'one redraw, no loop');
  store.timers.clear();
});

test('the arrows do nothing outside the rail', async () => {
  const { f, rail, h, snap } = railRig();
  const tick = focusableTick(f, 1);
  const store = started(f, h);
  await h.ready();
  await snap();
  tick.focus();
  const say = { tagName: 'DIV', id: 'say', dataset: {}, closest: () => null };
  const drawn = rail.writes;
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(keyOn(f, say, key), false, `${key} in the editor is the editor's`);
  assert.equal(rail.writes, drawn, 'the rail is not drawn');
  assert.equal(f.doc.activeElement, tick, 'focus does not move');
  store.timers.clear();
});

test('a jump pressed while Earlier messages reads pages on past that read to its turn', async () => {
  // turn 1 starts at 1; the read the key started brings 10-11, all turn 2's; the jump reads on to 2-3
  const turns = [{ turn: 1, seq: 1, prompt: 'a', response: '' }, { turn: 2, seq: 9, prompt: 'b', response: '' }, { turn: 3, seq: 29, prompt: 'c', response: '' }];
  const waits = [];
  const book = { 30: { records: [said(10), said(11)], hasMore: true }, 10: { records: [said(2), said(3)], hasMore: false } };
  const { f, rail, marks, h, snap } = railRig({ turns, pages: req => new Promise(r => waits.push(() => r(book[req.beforeSeq] ?? { records: [], hasMore: false }))) });
  const store = started(f, h);
  await h.ready();
  await snap();
  f.click({ tagName: 'BUTTON', dataset: { action: 'earlier', conv: 's1' } });
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: '1' } });
  await settle();
  while (waits.length) { waits.shift()(); await settle(); }
  assert.deepEqual(earlierPages(h), [30, 10]);
  assert.deepEqual(marks[1].scrolled, [{ block: 'start', drawn: true }]);
  assert.doesNotMatch(rail.innerHTML, /pulse/);
  store.timers.clear();
});

test('a jump whose pages land while a render is held scrolls to its mark once the render runs', async () => {
  const { f, marks, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  f.click({ tagName: 'BUTTON', dataset: { action: 'jumpTurn', turn: '1' } });
  f.fire('root', 'pointerdown', { button: 0 });
  await settle();
  assert.deepEqual(earlierPages(h), [30, 10]);
  assert.doesNotMatch(f.html(), /said 10/, 'held while the press is down');
  f.fire('doc', 'pointerup', { button: 0 });
  await settle();
  assert.match(f.html(), /said 10/);
  assert.deepEqual(marks[1].scrolled, [{ block: 'start', drawn: true }]);
  store.timers.clear();
});

test('the rail is not redrawn while a press is down, and is once it lets go', async () => {
  const { f, rail, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  await snap();
  const writes = rail.writes;
  f.fire('root', 'pointerdown', { button: 0 });
  f.fire('root', 'mouseover', { target: tickEl(1) });
  assert.equal(rail.writes, writes, 'held');
  f.fire('doc', 'pointerup', { button: 0 });
  await settle();
  assert.match(rail.innerHTML, /Turn 1 · jump/);
  store.timers.clear();
});

test('the turn the view is on is measured once the draft screen gives the conversation back', async () => {
  const { f, rail, h, snap } = railRig();
  const store = started(f, h);
  await h.ready();
  f.click({ tagName: 'BUTTON', dataset: { action: 'startDraft' } });
  await settle();
  assert.ok(store.get().draft);
  await snap();
  f.click({ tagName: 'BUTTON', dataset: { action: 'cancelDraft' } });
  await settle();
  assert.equal(store.get().draft, null);
  assert.match(rail.innerHTML, /class="turn-tick loaded active" id="turn-tick-3"/);
  store.timers.clear();
});

// ---- background jobs on screen (plan 5, Task 9): the open conversation's job/list, a job's follow, Stop, the clock
const T0 = 1_800_000_000_000;
const ajob = (id, status, more = {}) => ({ id, kind: 'bash', label: `run ${id}`, owner: 's1', status, startedAt: T0 - 64_000, output: { total: 6, earliest: 0 }, ...more });
const jobLists = h => h.streams.filter(s => s.name === 'job/list');
const liveList = h => jobLists(h).filter(s => !s.cancelled);
const follows = h => h.streams.filter(s => s.name === 'job/follow');
async function jobsRig({ holds = ms => ms === 1000 || ms === 2000 || ms === 10_000, rows = [row('s1', { agentAvailable: true }), row('s2', { agentAvailable: true })], kill = { outcome: 'requested' } } = {}) {
  const f = fakeWindow({ hash: '' });
  const h = host({ rows });
  const call0 = h.call;
  const call = async (endpoint, args) => (endpoint === 'job/kill' ? (h.calls.push([endpoint, args]), kill) : call0(endpoint, args));
  const timers = new HeldTimers(holds);
  const clock = { t: T0 };
  const store = boot(f.win, { editor: valueEditor, openMux: h.openMux, call, getJson: h.getJson, postJson: h.postJson, markdown: h.markdown, timers, now: () => clock.t });
  await h.ready();
  const give = jobs => { liveList(h).at(-1).cbs.onItem({ type: 'rows', jobs }); };
  return { f, h, store, timers, clock, give };
}
const goTo = async (f, hash) => { f.win.location.hash = hash; await settle(); };

test('opening a conversation watches its jobs, another conversation moves the watch, Markets stops it', async () => {
  const { f, h, store } = await jobsRig();
  assert.equal(store.get().route.id, 's1');
  assert.deepEqual(liveList(h).map(s => s.args), [{ request: { sessionId: 's1' } }]);
  await goTo(f, '#/messages/s2');
  assert.deepEqual(liveList(h).map(s => s.args), [{ request: { sessionId: 's2' } }], "s1's list cancelled, s2's open");
  assert.equal(jobLists(h).length, 2);
  await goTo(f, '#/messages/s2');
  assert.equal(jobLists(h).length, 2, 'the same conversation keeps its stream');
  await goTo(f, '#/markets');
  assert.deepEqual(liveList(h), [], 'off Messages nothing is watched');
  assert.equal(store.get().jobs.convId, null);
  store.timers.clear();
});

test('a host end of job/list in the page opens it again after the backoff, an error after the longer one', async () => {
  const { h, store, timers, give } = await jobsRig();
  give([ajob('j1', 'running')]);
  await settle();
  liveList(h)[0].cbs.onEnd();
  assert.ok(timers.delays().includes(2000), 'a re-open waits on the end backoff');
  assert.equal(store.get().jobs.rows.length, 1, 'the rows stay meanwhile');
  timers.run(2000);
  assert.equal(jobLists(h).length, 2);
  assert.deepEqual(jobLists(h)[1].args, { request: { sessionId: 's1' } });
  jobLists(h)[1].cbs.onError({ code: 'x' });
  assert.ok(timers.delays().includes(10_000));
  timers.run(10_000);
  assert.equal(jobLists(h).length, 3, 'opened again after an error too');
  store.timers.clear();
});

test('the chip opens Details at Background jobs', async () => {
  const { f, store, give } = await jobsRig();
  const scrolled = [];
  f.withId('dsec-jobs', { presentIf: /id="dsec-jobs"/, scrollIntoView(o) { scrolled.push(o); } });
  assert.doesNotMatch(f.html(), /jobs-chip/);
  give([ajob('j1', 'running')]);
  await settle();
  assert.match(f.html(), /class="btn-sm jobs-chip" data-action="openJobs"><span class="jobs-dot live"><\/span>1 job running/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openJobs' } });
  await settle();
  assert.equal(store.get().detailsOpen, true);
  assert.deepEqual(scrolled, [{ block: 'start' }]);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openJobs' } });
  await settle();
  assert.equal(store.get().detailsOpen, true, 'never closed by the chip');
  assert.equal(scrolled.length, 2, 'scrolled again with Details already open');
  store.timers.clear();
});

test('opening a job follows it and its output fills the pre without a render; a render writes it again', async () => {
  const { f, h, store, give } = await jobsRig();
  give([ajob('j1', 'running'), ajob('j2', 'running')]);
  store.dispatch('toggleDetails');
  await settle();
  const pre = f.withId('jobout-j1', { tagName: 'PRE', presentIf: /id="jobout-j1"/ });
  const note = f.withId('jobnote-j1', { presentIf: /id="jobnote-j1"/ });
  const details = { tagName: 'DETAILS', open: false };
  const summary = { tagName: 'SUMMARY', dataset: { action: 'openJob', job: 'j1' }, parentElement: details };
  f.click(summary);
  await settle();
  assert.equal(details.open, true);
  assert.equal(store.get().jobs.open, 'j1');
  assert.deepEqual(follows(h).map(s => s.args), [{ request: { sessionId: 's1', jobId: 'j1' } }]);
  assert.match(f.html(), /<details id="jobd-j1" class="job-details" open>/);
  const fl = follows(h)[0];
  fl.cbs.onItem({ type: 'opened', job: ajob('j1', 'running'), from: 0 });
  const writes = f.writes;
  fl.cbs.onItem({ type: 'output', chunks: [{ at: 0, text: 'hello\n' }], next: 6 });
  assert.equal(pre.textContent, 'hello\n');
  fl.cbs.onItem({ type: 'output', chunks: [{ at: 6, text: 'world' }], next: 11 });
  assert.equal(pre.textContent, 'hello\nworld');
  assert.equal(f.writes, writes, 'an output frame renders nothing');
  assert.equal(note.textContent, '');
  store.dispatch('hostStatus', { line: 'a stream frame' });
  await settle();
  assert.equal(pre.textContent, 'hello\nworld', 'kept across a render');
  // a follow the host refuses reads so, never quiet
  fl.cbs.onError({ code: 'job/not-found' });
  assert.equal(note.textContent, 'output unavailable: job/not-found');
  // closing it lets the follow go
  f.click(summary);
  await settle();
  assert.equal(details.open, false);
  assert.equal(store.get().jobs.open, null);
  assert.equal(fl.cancelled, true);
  // opened again, then gone from the rows: unfollowed
  details.open = false;
  f.click(summary);
  await settle();
  assert.equal(follows(h).length, 2);
  give([ajob('j2', 'running')]);
  await settle();
  assert.equal(follows(h)[1].cancelled, true, 'a job leaving the rows is unfollowed');
  assert.equal(store.get().jobs.open, null);
  store.timers.clear();
});

test('a job open while another conversation opens, or Details closes, is unfollowed', async () => {
  const { f, h, store, give } = await jobsRig();
  give([ajob('j1', 'running')]);
  store.dispatch('toggleDetails');
  await settle();
  f.click({ tagName: 'SUMMARY', dataset: { action: 'openJob', job: 'j1' }, parentElement: { tagName: 'DETAILS', open: false } });
  await settle();
  store.dispatch('toggleDetails');
  await settle();
  assert.equal(follows(h)[0].cancelled, true, 'Details closed');
  assert.equal(store.get().jobs.open, null);
  store.dispatch('toggleDetails');
  f.click({ tagName: 'SUMMARY', dataset: { action: 'openJob', job: 'j1' }, parentElement: { tagName: 'DETAILS', open: false } });
  await settle();
  await goTo(f, '#/messages/s2');
  assert.equal(follows(h)[1].cancelled, true, 'another conversation');
  store.timers.clear();
});

test('Yes, stop kills the job; No asks nothing', async () => {
  const { f, h, store, give } = await jobsRig();
  give([ajob('j1', 'running')]);
  store.dispatch('toggleDetails');
  await settle();
  const stop = { tagName: 'BUTTON', dataset: { action: 'stopJob', conv: 's1', job: 'j1' } };
  f.click(stop);
  await settle();
  assert.deepEqual(store.get().confirm, { action: 'stopJob', id: 'j1', conv: 's1' });
  assert.match(f.html(), /data-action="confirmYes">Yes, stop</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'cancelConfirm' } });
  await settle();
  assert.equal(h.calls.filter(c => c[0] === 'job/kill').length, 0);
  f.click(stop);
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  await settle();
  assert.deepEqual(h.calls.filter(c => c[0] === 'job/kill').map(c => c[1]), [{ request: { sessionId: 's1', jobId: 'j1' } }]);
  assert.equal(store.get().confirm, null);
  store.timers.clear();
});

test('the clock ticks without a render while a live job is drawn, and stops with none', async () => {
  const { f, store, timers, clock, give } = await jobsRig();
  const span = f.withSelector('[data-job-clock]', { dataset: { jobClock: String(T0 - 64_000) }, presentIf: /data-job-clock=/ });
  give([ajob('j1', 'running')]);
  await settle();
  timers.held.clear();   // the Account stream's 1 s re-open (no EventSource here): the 1 s timers held from now are the clock's
  assert.ok(!timers.delays().includes(1000), 'no clock while Details is shut');
  store.dispatch('toggleDetails');
  await settle();
  assert.match(f.html(), /<span data-job-clock="\d+">1m 04s<\/span>/);
  store.dispatch('hostStatus', { line: 'another render' });
  await settle();
  assert.equal(timers.delays().filter(ms => ms === 1000).length, 1, 'one clock, however many renders');
  clock.t += 2000;
  const writes = f.writes;
  timers.run(1000);
  assert.equal(span.textContent, '1m 06s');
  assert.equal(f.writes, writes, 'the tick renders nothing');
  assert.equal(timers.delays().filter(ms => ms === 1000).length, 1, 'and goes on');
  give([ajob('j1', 'completed', { finishedAt: T0 })]);
  await settle();
  timers.run(1000);
  assert.ok(!timers.delays().includes(1000), 'no live job drawn: the clock stops');
  store.timers.clear();
});

test('Clear hides the finished until the page reloads', async () => {
  const { f, store, give } = await jobsRig();
  give([ajob('f1', 'completed', { finishedAt: T0 })]);
  store.dispatch('toggleDetails');
  await settle();
  assert.match(f.html(), /id="jobs-finished-s1"/);
  assert.match(f.html(), /jobs-chip/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'clearJobs', conv: 's1' } });
  await settle();
  assert.doesNotMatch(f.html(), /jobs-finished|dsec-jobs|jobs-chip/);
  give([ajob('f1', 'completed', { finishedAt: T0 })]);
  await settle();
  assert.doesNotMatch(f.html(), /jobs-finished/, 'the next rows frame keeps it cleared');
  store.timers.clear();
  const again = await jobsRig();
  again.give([ajob('f1', 'completed', { finishedAt: T0 })]);
  again.store.dispatch('toggleDetails');
  await settle();
  assert.match(again.f.html(), /id="jobs-finished-s1"/, 'a reload shows it again');
  again.store.timers.clear();
});

// #jobout-<id> as the browser has it: each page write makes a fresh, empty node from the markup, and the node it took
// out of the document loses its scroll; replaceWith puts another in its place. Each node counts its textContent writes
function freshPres(f, id) {
  const made = [];
  let current = null, at = -1;
  const node = () => {
    let text = '';
    const n = { tagName: 'PRE', writes: 0, scrollTop: 0, scrollHeight: 0, clientHeight: 200, replaceWith(other) { current = other; } };
    Object.defineProperty(n, 'textContent', { get: () => text, set: v => { text = String(v); n.writes++; } });
    return n;
  };
  const byId = f.doc.getElementById.bind(f.doc);
  f.doc.getElementById = want => {
    if (want !== `jobout-${id}`) return byId(want);
    if (at !== f.writes) {
      at = f.writes;
      if (current) current.scrollTop = 0;
      current = new RegExp(`id="jobout-${id}"`).test(f.html()) ? node() : null;
      if (current) made.push(current);
    }
    return current;
  };
  return { made };
}

test("a render keeps the open job's pre: the same node, its output not written again, its scroll where it was", async () => {
  const { f, store, h, give } = await jobsRig();
  give([ajob('j1', 'running')]);
  store.dispatch('toggleDetails');
  await settle();
  const { made } = freshPres(f, 'j1');
  f.click({ tagName: 'SUMMARY', dataset: { action: 'openJob', job: 'j1' }, parentElement: { tagName: 'DETAILS', open: false } });
  await settle();
  const pre = f.doc.getElementById('jobout-j1');
  assert.ok(pre);
  follows(h)[0].cbs.onItem({ type: 'output', chunks: [{ at: 0, text: 'out\n' }], next: 4 });
  assert.equal(pre.textContent, 'out\n', 'a frame writes it');
  const writes = pre.writes;
  pre.scrollTop = 120;
  const count = made.length;
  store.dispatch('hostStatus', { line: 'a stream frame' });
  await settle();
  assert.ok(made.length > count, 'the page write made a new node');
  assert.equal(f.doc.getElementById('jobout-j1'), pre, 'the first node is back in place');
  assert.equal(pre.writes, writes, 'the render writes no output');
  assert.equal(pre.scrollTop, 120, 'its scroll put back');
  follows(h)[0].cbs.onItem({ type: 'output', chunks: [{ at: 4, text: 'more' }], next: 8 });
  assert.equal(pre.textContent, 'out\nmore', 'the next frame writes it');
  store.timers.clear();
});

test('a render puts the open job\'s pre back before the drawer keeps its scroll', async () => {
  const { f, store, h, give } = await jobsRig();
  give([ajob('j1', 'running')]);
  store.dispatch('toggleDetails');
  await settle();
  freshPres(f, 'j1');
  const drawer = f.withSelector('.drawer-body', { presentIf: /class="drawer details"/ });
  const seen = [];
  let top = 0;
  Object.defineProperty(drawer, 'scrollTop', { get: () => top, set: v => { top = v; seen.push([v, f.doc.getElementById('jobout-j1')?.textContent]); }, configurable: true });
  f.click({ tagName: 'SUMMARY', dataset: { action: 'openJob', job: 'j1' }, parentElement: { tagName: 'DETAILS', open: false } });
  await settle();
  follows(h)[0].cbs.onItem({ type: 'output', chunks: [{ at: 0, text: 'out\n' }], next: 4 });
  top = 300;
  seen.length = 0;
  store.dispatch('hostStatus', { line: 'a stream frame' });
  await settle();
  const kept = seen.filter(([v]) => v === 300);
  assert.equal(kept.length, 1, 'the drawer keeps its place');
  assert.equal(kept[0][1], 'out\n', 'the filled pre was in place before the keep ran');
  store.timers.clear();
});

test('a Stop confirm whose job stopped running goes, so Esc closes Details', async () => {
  const { f, store, give } = await jobsRig();
  give([ajob('j1', 'running')]);
  store.dispatch('toggleDetails');
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'stopJob', conv: 's1', job: 'j1' } });
  await settle();
  assert.equal(store.get().confirm?.action, 'stopJob');
  give([ajob('j1', 'completed', { finishedAt: T0 })]);
  await settle();
  assert.equal(store.get().confirm, null, 'the confirm on a finished job is dropped');
  f.fire('doc', 'keydown', { key: 'Escape' });
  await settle();
  assert.equal(store.get().detailsOpen, false);
  store.timers.clear();
});

test('Yes, stop marks the job stopping at once and puts focus on its Stopping', async () => {
  const { f, h, store, give } = await jobsRig();
  const stopping = f.withId('job-stopping-j1', { presentIf: /id="job-stopping-j1"/ });
  give([ajob('j1', 'running')]);
  store.dispatch('toggleDetails');
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'stopJob', conv: 's1', job: 'j1' } });
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  await settle();
  assert.equal(store.get().jobs.rows[0].status, 'stopping');
  assert.doesNotMatch(f.html(), /data-action="stopJob"/, 'no second Stop to press');
  assert.equal(f.doc.activeElement, stopping);
  assert.equal(h.calls.filter(c => c[0] === 'job/kill').length, 1);
  store.timers.clear();
});

test('a refused Stop puts the job back to running', async () => {
  const { store, give, f } = await jobsRig({ kill: { outcome: 'nope' } });
  give([ajob('j1', 'running')]);
  store.dispatch('toggleDetails');
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'stopJob', conv: 's1', job: 'j1' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  await settle();
  assert.equal(store.get().jobs.rows[0].status, 'running');
  assert.match(f.html(), /data-action="stopJob"/);
  store.timers.clear();
});

// ── Account › Identity (plan B1b Task 1): its own read, on entering the tab, at the page's cadence while it shows, Retry fresh ──

const IDENTITY_READ = {
  ok: true,
  networks: [{ network: 'telegram', speaksAs: '@gravit_desk_bot', talksOnlyWith: '@pan', since: '2026-11-03T15:20:00.000Z', fingerprint: 'ab12cd34', state: 'connected', polling: true }],
  routing: { chat: ['telegram'], alerts: ['telegram'], brief: [], cards: ['telegram'], fills: ['telegram'] }, quiet: { from: '23:00', to: '07:00', zone: 'America/New_York' }, strangers: [],
};
const isIdentity = path => path.split('?')[0] === '/data/account/identity';

test('Identity reads the account on entering the tab and with each beat while it shows; Retry and Refresh read it past the cache', async () => {
  const f = fakeWindow({ hash: '#/messages/s1', storage: memoryStorage() });
  let down = false;
  const h = accountHost({ rows: [row('s1')] }, {
    answers: { '/data/account/identity': () => (down ? Promise.reject(Object.assign(new Error('HTTP 503'), { status: 503, body: { ok: false, error: 'The account did not answer.' } })) : IDENTITY_READ) },
  });
  const timers = new HeldTimers();
  const store = bootAccount(f, h, fakeMarkets(), { timers });
  await h.ready();
  assert.deepEqual(h.reads.filter(isIdentity), [], 'not read off the tab');
  f.win.location.hash = '#/account/identity';
  await settle();
  assert.deepEqual(h.reads.filter(isIdentity), ['/data/account/identity']);
  assert.match(f.html(), /aria-label="Gravit"/);
  assert.match(f.html(), /@gravit_desk_bot/);
  // a beat reads the page and Identity, plain
  h.reads.length = 0;
  timers.run(20_000);
  await settle();
  assert.deepEqual(h.reads.filter(isIdentity), ['/data/account/identity']);
  // the account down: the tab says so and draws no connection; Retry reads past the cache
  down = true;
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshAccount' } });
  await settle();
  assert.deepEqual(h.reads.filter(isIdentity), ['/data/account/identity?fresh=1'], 'Refresh on Identity reads it past the cache');
  assert.match(f.html(), /The account is not answering\./);
  assert.doesNotMatch(f.html(), /@gravit_desk_bot/);
  down = false;
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'refreshIdentity' } });
  await settle();
  assert.deepEqual(h.reads.filter(isIdentity), ['/data/account/identity?fresh=1']);
  assert.match(f.html(), /@gravit_desk_bot/);
  // every query the client sent passes the face's proxy whitelist (the fake host ignores queries; the proxy does not)
  const sent = [...new Set(h.reads.filter(isIdentity))];
  assert.ok(sent.includes('/data/account/identity?fresh=1'));
  for (const path of sent) assert.notEqual(rebuildQuery('identity', path), null, `${path} passes the proxy`);
  // Details opens the connection's line
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityDetails' } });
  assert.match(f.html(), /token ab12cd34 · polling/);
  // another tab: its beats read no Identity
  f.win.location.hash = '#/account/rules';
  await settle();
  h.reads.length = 0;
  timers.run(20_000);
  await settle();
  assert.deepEqual(h.reads.filter(isIdentity), []);
  store.timers.clear();
});

test("Identity's grid ticks change the draft only on a page that signs, and Save… appears while it differs", async () => {
  const f = fakeWindow({ hash: '#/account/identity', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/identity': IDENTITY_READ } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.doesNotMatch(f.html(), />Save…</);
  const tick = on => f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', checked: on, dataset: { action: 'identityTick', row: 'brief', network: 'telegram' } } });
  tick(true);
  assert.deepEqual(store.get().identity.draft.brief, ['telegram']);
  assert.match(f.html(), /data-action="openSheet" data-kind="routing"[^>]*>Save…</);
  tick(false);
  assert.equal(store.get().identity.draft, null);
  assert.doesNotMatch(f.html(), />Save…</);
  store.timers.clear();
});

test("a venue's Disconnect done reads no Identity: the identity disconnect is its own kind, disconnectNetwork", async () => {
  const f = fakeWindow({ hash: '#/account/venues', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/identity': IDENTITY_READ } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'askDisconnect', venue: 'ex', name: 'Stand-in Exchange' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'confirmYes' } });
  assert.equal(store.get().sheet.kind, 'disconnect');
  await until(() => store.get().sheet?.status === 'ready', 'the preparation');
  h.reads.length = 0;
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().sheet === null, 'the done sheet to close');
  await settle();
  assert.ok(h.reads.includes('/data/account?fresh=1'), 'the page read again');
  assert.deepEqual(h.reads.filter(isIdentity), [], 'no Identity read');
  store.timers.clear();
});

// ── Account › Identity's Connect Telegram (plan B1b Task 2): the drawer over the page, the token read from its field once ──

test('Connect… opens sheet 1 on a page that signs; Next posts the field\'s token once and clears it; Escape closes and drops the pending connection', async () => {
  const TOKEN = '7000000001:AAFakeTokenForTestsOnly_abcdefghijklmn';
  const PENDING = { id: '0123456789abcdef0123456789abcdef', network: 'telegram', bot: { id: '777', username: 'gravit_desk_bot', name: 'Gravit' }, link: 'https://t.me/gravit_desk_bot', qr: '', expiresAt: '2099-01-01T00:00:00.000Z', state: 'waiting' };
  const NOT_CONNECTED = { ok: true, networks: [], routing: { chat: [], alerts: [], brief: [], cards: [], fills: [] }, quiet: null, strangers: [] };
  const f = fakeWindow({ hash: '#/account/identity', storage: memoryStorage() });
  const field = f.withSelector('#identity-token', { tagName: 'INPUT', type: 'password', id: 'identity-token' });
  const door = ownerDoor();
  const posted = [];
  const ownerPost = async (path, body) => {
    if (path.startsWith('/data/account/identity/')) {
      posted.push([path, body]);
      return path.endsWith('/telegram/token') ? { status: 200, body: { ok: true, pending: PENDING } } : { status: 200, body: { ok: true } };
    }
    return door.post(path, body);
  };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/identity': NOT_CONNECTED, '/data/account/identity/pending': { ok: true, pending: PENDING } } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="identityConnect" data-network="telegram">Connect…</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityConnect', network: 'telegram' } });
  assert.match(f.html(), /<aside class="drawer sheet" aria-label="Connect Telegram · 1 of 4 · Bot token">/);
  assert.match(f.html(), /<input id="identity-token" class="input" type="password" autocomplete="off" spellcheck="false"/);
  field.value = ` ${TOKEN} `;
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityNext' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityNext' } });
  await until(() => store.get().identity.connect?.step === 2, 'sheet 2');
  const sent = posted.filter(([p]) => p === '/data/account/identity/telegram/token');
  assert.equal(sent.length, 1, 'once');
  assert.equal(sent[0][1].token, TOKEN);
  assert.equal(field.value, '', 'the field cleared');
  assert.ok(!JSON.stringify(store.get()).includes(TOKEN), 'no token in the store');
  assert.ok(!f.html().includes(TOKEN), 'none on the page');
  assert.match(f.html(), /Connect Telegram · 2 of 4 · Say hi/);
  // Escape: the drawer closed, its pending connection dropped at once
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().identity.connect, null);
  await settle();
  assert.deepEqual(posted.filter(([p]) => p === '/data/account/identity/pending/drop').map(([, b]) => b), [{ id: PENDING.id }]);
  assert.doesNotMatch(f.html(), /Connect Telegram ·/);
  store.timers.clear();
});

test('Install app… opens Slack\'s sheet 1; Next posts both fields once and clears them; Copy falls back to selecting the manifest', async () => {
  // made-up tokens joined at run time: no scanner-shaped literal in the tree
  const APP = ['xa', 'pp-1-A0FAKE0001-1234567-', 'ab'.repeat(32)].join('');
  const BOT = ['xo', 'xb-', '1111111-2222222-', 'FakeBotTokenForTestsOnly00'].join('');
  const PENDING = { id: 'fedcba9876543210fedcba9876543210', network: 'slack', bot: { id: 'T0FAKE001:U0BOT0001', username: 'gravit', name: 'Gravit' }, workspace: 'Fake Co', link: 'https://slack.com/app_redirect?app=A0FAKE0001&team=T0FAKE001', qr: '', expiresAt: '2099-01-01T00:00:00.000Z', state: 'waiting' };
  const READ = { ok: true, networks: [], routing: { chat: [], alerts: [], brief: [], cards: [], fills: [] }, quiet: null, strangers: [], slackManifest: '{"display_information":{"name":"Gravit"}}' };
  const f = fakeWindow({ hash: '#/account/identity', storage: memoryStorage() });
  const app = f.withSelector('#identity-app-token', { tagName: 'INPUT', type: 'password', id: 'identity-app-token' });
  const bot = f.withSelector('#identity-bot-token', { tagName: 'INPUT', type: 'password', id: 'identity-bot-token' });
  const pre = f.withSelector('#identity-manifest', { tagName: 'PRE', id: 'identity-manifest' });
  const selected = [];
  f.win.getSelection = () => ({ removeAllRanges() {}, selectAllChildren: el => selected.push(el) });
  f.win.navigator = { clipboard: { writeText: async () => { throw new Error('denied'); } } };
  const door = ownerDoor();
  const posted = [];
  const ownerPost = async (path, body) => {
    if (path.startsWith('/data/account/identity/')) {
      posted.push([path, body]);
      return path.endsWith('/slack/token') ? { status: 200, body: { ok: true, pending: PENDING } } : { status: 200, body: { ok: true } };
    }
    return door.post(path, body);
  };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/identity': READ, '/data/account/identity/pending': { ok: true, pending: PENDING } } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  assert.match(f.html(), /data-action="identityConnect" data-network="slack">Install app…</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityConnect', network: 'slack' } });
  assert.match(f.html(), /<aside class="drawer sheet" aria-label="Connect Slack · 1 of 4 · App tokens">/);
  assert.match(f.html(), /display_information/);
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityCopyManifest' } });
  await settle();
  assert.deepEqual(selected, [pre], 'the clipboard refused: the manifest selected');
  // Enter in the app-level field moves on, posting nothing
  app.value = ` ${APP} `;
  f.fire('doc', 'keydown', { key: 'Enter' });
  bot.value = BOT;
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityNext' } });
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityNext' } });
  await until(() => store.get().identity.connect?.step === 2, 'sheet 2');
  const sent = posted.filter(([p]) => p === '/data/account/identity/slack/token');
  assert.equal(sent.length, 1, 'once');
  assert.equal(sent[0][1].appToken, APP);
  assert.equal(sent[0][1].botToken, BOT);
  assert.equal(app.value, '');
  assert.equal(bot.value, '');
  assert.ok(!JSON.stringify(store.get()).includes(BOT) && !JSON.stringify(store.get()).includes(APP), 'no token in the store');
  assert.ok(!f.html().includes(BOT) && !f.html().includes(APP), 'none on the page');
  assert.match(f.html(), /Connect Slack · 2 of 4 · Say hi/);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().identity.connect, null);
  store.timers.clear();
});

test('a page that does not sign opens no Connect Telegram', async () => {
  const f = fakeWindow({ hash: '#/account/identity', storage: memoryStorage() });
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account/identity': { ok: true, networks: [], routing: {}, quiet: null, strangers: [] } } });
  const store = bootAccount(f, h);
  await h.ready();
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityConnect', network: 'telegram' } });
  assert.equal(store.get().identity.connect, null);
  assert.doesNotMatch(f.html(), /Connect Telegram ·/);
  store.timers.clear();
});

// ── Account › Identity's signed sheets (plan B1b Task 3): Disconnect, What reaches you where, Block ──

test('a done identity sheet reads Identity again past the face\'s cache', async () => {
  const READ = { ...IDENTITY_READ, strangers: [{ network: 'telegram', sender: '0a1b2c3d4e5f', masked: '…789', count: 3, last: '2026-11-04T14:00:00.000Z' }] };
  const f = fakeWindow({ hash: '#/account/identity', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/identity': READ } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  async function signed(open, kind) {
    open();
    assert.equal(store.get().sheet?.kind, kind);
    await until(() => store.get().sheet?.status === 'ready', `${kind} prepared`);
    h.reads.length = 0;
    f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
    await until(() => store.get().sheet === null, `${kind} done and closed`);
    await settle();
    assert.ok(h.reads.includes('/data/account/identity?fresh=1'), `${kind}: Identity read past the cache`);
    return door.sent('/data/account/exchange').at(-1).action;
  }
  // Disconnect…: the identity's own kind, the network the key names
  assert.match(f.html(), /data-action="openSheet" data-kind="disconnectNetwork" data-network="telegram"[^>]*>Disconnect…</);
  const off = await signed(() => f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'disconnectNetwork', network: 'telegram' } }), 'disconnectNetwork');
  assert.equal(off.type, 'disconnectNetwork');
  assert.equal(off.network, 'telegram');
  // Block: the stranger the key names
  const block = await signed(() => f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'block', network: 'telegram', sender: '0a1b2c3d4e5f', masked: '…789' } }), 'block');
  assert.deepEqual([block.type, block.network, block.sender, block.masked], ['blockSender', 'telegram', '0a1b2c3d4e5f', '…789']);
  // Save…: the grid's unsaved ticks as the account's string, the quiet hours as they are
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', checked: true, dataset: { action: 'identityTick', row: 'brief', network: 'telegram' } } });
  const saved = await signed(() => f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'routing' } }), 'routing');
  assert.deepEqual([saved.type, saved.routing, saved.quietFrom, saved.quietTo], ['setRouting', 'chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram', '23:00', '07:00']);
  store.timers.clear();
});

test('Change… on quiet hours: Off sends both ends empty; an unchanged sheet says so and signs nothing', async () => {
  const f = fakeWindow({ hash: '#/account/identity', storage: memoryStorage() });
  const door = ownerDoor();
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/identity': IDENTITY_READ } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'routing' } });
  assert.equal(store.get().sheet.kind, 'routing');
  await settle();
  assert.equal(store.get().sheet.status, 'incomplete');
  assert.match(f.html(), /That is how it is now/);
  assert.match(f.html(), /type="time" name="quietFrom" value="23:00"/);
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', name: 'quietOff', checked: true, value: 'true', dataset: { action: 'sheetField' } } });
  await until(() => store.get().sheet?.status === 'ready', 'quiet hours off prepared');
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().sheet === null, 'done');
  const a = door.sent('/data/account/exchange').at(-1).action;
  assert.deepEqual([a.type, a.routing, a.quietFrom, a.quietTo], ['setRouting', 'chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram', '', '']);
  store.timers.clear();
});

test('Enter in the bot token field is Next: the token posted once, with no form for the browser to offer to keep', async () => {
  const TOKEN = '7000000001:AAFakeTokenForTestsOnly_abcdefghijklmn';
  const PENDING = { id: '0123456789abcdef0123456789abcdef', network: 'telegram', bot: { id: '777', username: 'gravit_desk_bot', name: 'Gravit' }, link: 'https://t.me/gravit_desk_bot', qr: '', expiresAt: '2099-01-01T00:00:00.000Z', state: 'waiting' };
  const f = fakeWindow({ hash: '#/account/identity', storage: memoryStorage() });
  const field = f.withSelector('#identity-token', { tagName: 'INPUT', type: 'password', id: 'identity-token' });
  const door = ownerDoor();
  const posted = [];
  const ownerPost = async (path, body) => {
    if (path.startsWith('/data/account/identity/')) { posted.push([path, body]); return { status: 200, body: { ok: true, pending: PENDING } }; }
    return door.post(path, body);
  };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/identity': { ...IDENTITY_READ, networks: [] }, '/data/account/identity/pending': { ok: true, pending: PENDING } } });
  const store = bootAccount(f, h, fakeMarkets(), { ownerPost });
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  f.click({ tagName: 'BUTTON', dataset: { action: 'identityConnect', network: 'telegram' } });
  assert.doesNotMatch(f.html(), /<form[^>]*identityNext/);
  field.value = TOKEN;
  let prevented = 0;
  f.doc.activeElement = field;
  f.fire('doc', 'keydown', { key: 'Enter', preventDefault() { prevented += 1; } });
  f.doc.activeElement = field;
  f.fire('doc', 'keydown', { key: 'Enter', preventDefault() { prevented += 1; } });
  await until(() => store.get().identity.connect?.step === 2, 'sheet 2');
  assert.equal(posted.filter(([p]) => p.endsWith('/telegram/token')).length, 1);
  assert.equal(prevented, 2);
  assert.equal(field.value, '');
  store.timers.clear();
});

test('a draft tick for a network a fresh read shows not connected is dropped: after Disconnect, Change… prepares and no Save… is offered', async () => {
  const f = fakeWindow({ hash: '#/account/identity', storage: memoryStorage() });
  const door = ownerDoor();
  let gone = false;
  const AFTER = { ...IDENTITY_READ, networks: [], routing: { chat: [], alerts: [], brief: [], cards: [], fills: [] } };
  const h = accountHost({ rows: [row('s1')] }, { answers: { '/data/account': () => door.page(), '/data/account/identity': () => (gone ? AFTER : IDENTITY_READ) } });
  const store = bootOwner(f, h, door);
  await h.ready();
  await until(signs(store), 'the page to sign');
  await settle();
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', checked: true, dataset: { action: 'identityTick', row: 'brief', network: 'telegram' } } });
  assert.match(f.html(), />Save…</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'disconnectNetwork', network: 'telegram' } });
  await until(() => store.get().sheet?.status === 'ready', 'disconnect prepared');
  gone = true;
  f.click({ tagName: 'BUTTON', dataset: { action: 'sheetSubmit' } });
  await until(() => store.get().sheet === null, 'disconnect done');
  await until(() => store.get().identity.data?.networks?.length === 0, 'the fresh read');
  assert.equal(store.get().identity.draft, null, 'the stale tick dropped');
  assert.doesNotMatch(f.html(), />Save…</);
  f.click({ tagName: 'BUTTON', dataset: { action: 'openSheet', kind: 'routing' } });
  assert.equal(store.get().sheet.seed.routing.brief.length, 0, 'seeded from the account, not the stale tick');
  f.fire('root', 'change', { target: { tagName: 'INPUT', type: 'checkbox', name: 'quietOff', checked: true, value: 'true', dataset: { action: 'sheetField' } } });
  await until(() => store.get().sheet?.status === 'ready', 'quiet hours off prepared');
  assert.equal(door.posts.filter(([p]) => p === '/data/account/prepare').at(-1)[1].draft.routing, 'chat=;alerts=;brief=;cards=;fills=');
  store.timers.clear();
});

// the keys (plan 6 task 14): one table matched on the code, ⌥⌘N, ⌥⌘, and ⌘/ beside ⌥⌘K; never over the lightbox or an
// owner sheet, never while an IME composes
const chord = (code, mods, onPrevent = () => {}) => ({ key: '?', code, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...mods, preventDefault: onPrevent });
const macRig = async (hash = '#/messages/s1') => {
  const f = fakeWindow({ hash });
  f.win.navigator = { platform: 'MacIntel' };
  const say = f.withId('say', { tagName: 'TEXTAREA' });
  const h = host({ rows: [row('s1')] });
  const store = started(f, h);
  await h.ready();
  await settle();
  return { f, h, store, say };
};

test('⌥⌘N from the editor opens New message', async () => {
  const { f, store, say } = await macRig();
  say.focus();
  let prevented = false;
  f.fire('doc', 'keydown', chord('KeyN', { altKey: true, metaKey: true, key: 'ñ' }, () => { prevented = true; }));
  await settle();
  assert.ok(prevented, "the browser's own key is not run");
  assert.deepEqual(store.get().route, { screen: 'messages', id: 'new' });
  assert.ok(store.get().draft, 'a draft stands');
  store.timers.clear();
});

test('⌥⌘, opens Settings from an input', async () => {
  const { f, store } = await macRig();
  const cq = searchBox(f);
  cq.focus();
  let prevented = false;
  f.fire('doc', 'keydown', chord('Comma', { altKey: true, metaKey: true, key: '≤' }, () => { prevented = true; }));
  assert.ok(prevented);
  assert.equal(store.get().settingsOpen, true);
  store.timers.clear();
});

test('⌘/ opens the sheet and ⌘/ again closes it', async () => {
  const { f, store, say } = await macRig();
  say.focus();
  assert.equal(store.get().shortcuts, null, 'closed at boot');
  let prevented = 0;
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true, key: '/' }, () => { prevented += 1; }));
  assert.deepEqual(store.get().shortcuts, { q: '' });
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true, key: '/' }, () => { prevented += 1; }));
  assert.equal(store.get().shortcuts, null);
  assert.equal(prevented, 2);
  // with the sheet open another General key closes it first; Esc closes it before Settings under it
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true }));
  f.fire('doc', 'keydown', chord('Comma', { altKey: true, metaKey: true }));
  assert.deepEqual([store.get().shortcuts, store.get().settingsOpen], [null, true]);
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true }));
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.deepEqual([store.get().shortcuts, store.get().settingsOpen], [null, true], 'Esc closes the sheet, Settings stays');
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true }));
  f.fire('doc', 'keydown', chord('KeyK', { altKey: true, metaKey: true }));
  assert.equal(store.get().shortcuts, null, '⌥⌘K closes it too');
  store.timers.clear();
});

test('Ctrl+Alt+N on a Mac does nothing', async () => {
  const { f, store, say } = await macRig();
  say.focus();
  const before = store.get();
  let prevented = false;
  f.fire('doc', 'keydown', chord('KeyN', { altKey: true, ctrlKey: true }, () => { prevented = true; }));
  f.fire('doc', 'keydown', chord('Slash', { ctrlKey: true }, () => { prevented = true; }));
  await settle();
  assert.equal(prevented, false, 'the browser keeps the keys');
  assert.equal(store.get(), before);
  // off a Mac they are the keys
  const g = fakeWindow({ hash: '#/messages/s1' });
  const h2 = host({ rows: [row('s1')] });
  const s2 = started(g, h2);
  await h2.ready();
  g.fire('doc', 'keydown', chord('KeyN', { altKey: true, ctrlKey: true }));
  await settle();
  assert.deepEqual(s2.get().route, { screen: 'messages', id: 'new' });
  g.fire('doc', 'keydown', chord('Slash', { ctrlKey: true }));
  assert.deepEqual(s2.get().shortcuts, { q: '' });
  store.timers.clear();
  s2.timers.clear();
});

test('⌥⌘, while What you sign stands, and ⌥⌘N while pinyin composes, do nothing', async () => {
  const { f, store, say } = await macRig('#/account/agents');
  store.dispatch('sheetOpen', { kind: 'subWallet', seed: {}, fields: {} });
  const before = store.get();
  for (const ev of [chord('Comma', { altKey: true, metaKey: true }), chord('KeyN', { altKey: true, metaKey: true }), chord('Slash', { metaKey: true })]) {
    f.fire('doc', 'keydown', ev);
  }
  await settle();
  assert.equal(store.get().settingsOpen, false, 'no Settings over the signing sheet');
  assert.equal(store.get().shortcuts, null);
  assert.deepEqual(store.get().route, before.route);
  assert.equal(store.get().sheet.kind, 'subWallet', 'the sheet stands');
  store.dispatch('sheetClose');
  f.win.location.hash = '#/messages/s1'; f.fire('win', 'hashchange'); await settle();
  say.focus();
  const route = store.get().route;
  f.fire('doc', 'keydown', chord('KeyN', { altKey: true, metaKey: true, isComposing: true }));
  f.fire('doc', 'keydown', chord('KeyN', { altKey: true, metaKey: true, keyCode: 229 }));
  await settle();
  assert.deepEqual(store.get().route, route, 'the composition keeps its keys');
  assert.equal(store.get().draft, null);
  store.timers.clear();
});

test('⌥⌘N and ⌘/ do nothing over the lightbox', async () => {
  const { f, store, image } = await lightboxRig();
  f.click(image);
  const route = store.get().route;
  f.fire('doc', 'keydown', chord('KeyN', { altKey: true, ctrlKey: true }));
  f.fire('doc', 'keydown', chord('Slash', { ctrlKey: true }));
  f.fire('doc', 'keydown', chord('Comma', { altKey: true, ctrlKey: true }));
  await settle();
  assert.deepEqual(store.get().route, route);
  assert.equal(store.get().shortcuts, null);
  assert.equal(store.get().settingsOpen, false);
  assert.ok(store.get().lightbox, 'the lightbox stays');
  store.timers.clear();
});

// the shortcut sheet (plan 6 task 15): over any drawer, focus in its box, Tab kept inside it, Esc after the lightbox and
// before the drawer under it; focus back on what opened it
const sheetRig = async (hash = '#/messages/s1') => {
  const rig = await macRig(hash);
  const { f } = rig;
  const showAll = f.withId('show-shortcuts', { tagName: 'BUTTON', dataset: { action: 'openShortcuts' }, presentIf: /id="show-shortcuts"/ });
  const box = f.withId('sc-q', { tagName: 'INPUT', type: 'search', dataset: { action: 'scQuery' }, presentIf: /id="sc-q"/ });
  const close = f.alsoAs('.shortcuts .close-key', f.withId('sc-close', { tagName: 'BUTTON', dataset: { action: 'closeShortcuts' }, presentIf: /class="shortcuts"/ }));
  const drawerClose = f.withSelector('.drawer .close-key', { tagName: 'BUTTON', dataset: { action: 'closeSettings' }, presentIf: /class="drawer"/ });
  return { ...rig, showAll, box, close, drawerClose };
};

test('Show all opens the sheet over Settings with focus in its box; Esc closes the sheet, focus back on Show all, a second Esc closes Settings', async () => {
  const { f, store, showAll, box, drawerClose, say } = await sheetRig();
  say.focus();
  f.fire('doc', 'keydown', chord('Comma', { altKey: true, metaKey: true }));
  assert.equal(f.doc.activeElement, drawerClose, 'Settings takes focus');
  assert.match(f.html(), /<div class="dsec-label">Keyboard shortcuts<\/div><div class="btn-row"><button type="button" id="show-shortcuts" class="btn-sm" data-action="openShortcuts">Show all<\/button><kbd class="sc-key">⌘\/<\/kbd><\/div>/);
  showAll.focus();
  f.click(showAll);
  assert.deepEqual(store.get().shortcuts, { q: '' });
  assert.equal(store.get().settingsOpen, true, 'Settings stays under it');
  assert.match(f.html(), /<aside class="drawer"[\s\S]*<\/main><div class="scrim" data-action="closeShortcuts"><\/div><section class="shortcuts"/, 'drawn after the drawers');
  assert.equal(f.doc.activeElement, box, 'focus in its box');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().shortcuts, null);
  assert.equal(store.get().settingsOpen, true);
  assert.equal(f.doc.activeElement, showAll, 'back on Show all');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().settingsOpen, false);
  assert.equal(f.doc.activeElement, say, "back on Settings' own opener");
  // ⌘/ from the editor: focus back on the editor
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true }));
  assert.equal(f.doc.activeElement, box);
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true }));
  assert.equal(f.doc.activeElement, say);
  store.timers.clear();
});

test('Tab stays inside the sheet', async () => {
  const { f, store, box, close, say } = await sheetRig();
  say.focus();
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true }));
  assert.equal(f.doc.activeElement, box);
  let prevented = 0;
  const tab = shiftKey => f.fire('doc', 'keydown', { key: 'Tab', shiftKey, preventDefault() { prevented += 1; } });
  tab(false);
  assert.equal(f.doc.activeElement, close);
  tab(false);
  assert.equal(f.doc.activeElement, box);
  tab(true);
  assert.equal(f.doc.activeElement, close);
  tab(true);
  assert.equal(f.doc.activeElement, box);
  assert.equal(prevented, 4, "the browser's own Tab never leaves it");
  // a render while the close key has focus keeps it there
  tab(false);
  store.dispatch('toggleRail');
  assert.equal(f.doc.activeElement, close);
  store.timers.clear();
});

test('Esc with the lightbox over the sheet closes the lightbox first', async () => {
  const { f, store, image, close: lightClose } = await lightboxRig();
  const box = f.withId('sc-q', { tagName: 'INPUT', type: 'search', dataset: { action: 'scQuery' }, presentIf: /id="sc-q"/ });
  f.fire('doc', 'keydown', chord('Slash', { ctrlKey: true }));
  assert.equal(f.doc.activeElement, box);
  f.click(image);
  assert.ok(store.get().lightbox);
  assert.equal(f.doc.activeElement, lightClose);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().lightbox, null);
  assert.ok(store.get().shortcuts, 'the sheet stands');
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().shortcuts, null);
  store.timers.clear();
});

test('typing in the box filters and keeps the words across the render', async () => {
  const { f, store, box, say } = await sheetRig();
  say.focus();
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true }));
  box.value = 'Send';
  box.selectionStart = 4; box.selectionEnd = 4;
  f.fire('root', 'input', { target: box });
  assert.deepEqual(store.get().shortcuts, { q: 'Send' });
  assert.equal(box.value, 'Send', 'the words stay in the box');
  assert.equal(f.doc.activeElement, box);
  assert.deepEqual([box.selectionStart, box.selectionEnd], [4, 4], 'and the caret');
  assert.match(f.html(), /<span class="sc-what">Send<\/span>/);
  assert.doesNotMatch(f.html(), /New conversation/);
  // ordinary typing leaves it open; a stream frame keeps the words
  store.dispatch('toggleRail');
  assert.equal(box.value, 'Send');
  assert.ok(store.get().shortcuts);
  store.timers.clear();
});

test('the scrim closes it', async () => {
  const { f, store, say } = await sheetRig();
  say.focus();
  f.fire('doc', 'keydown', chord('Slash', { metaKey: true }));
  assert.match(f.html(), /<div class="scrim" data-action="closeShortcuts"><\/div>/);
  f.click({ tagName: 'DIV', dataset: { action: 'closeShortcuts' } });
  assert.equal(store.get().shortcuts, null);
  assert.equal(f.doc.activeElement, say);
  store.timers.clear();
});

test('⌥⌘K over an owner sheet does nothing', async () => {
  const { f, store, say } = await macRig('#/messages/s1');
  const cq = searchBox(f);
  say.focus();
  store.dispatch('sheetOpen', { kind: 'subWallet', seed: {}, fields: {} });
  const before = store.get();
  let prevented = false;
  f.fire('doc', 'keydown', chord('KeyK', { altKey: true, metaKey: true }, () => { prevented = true; }));
  await settle();
  assert.ok(prevented, "the browser's own key is not run either");
  assert.notEqual(f.doc.activeElement, cq, 'the search box does not take focus behind the sheet');
  assert.deepEqual(store.get().route, before.route);
  assert.equal(store.get().sheet.kind, 'subWallet');
  store.timers.clear();
});
