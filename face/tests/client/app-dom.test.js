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
function host({ rows = [], pages = {} } = {}) {
  const streams = [];
  let opts = null;
  const mux = { stream(name, args, cbs) { const s = { name, args, cbs, cancelled: false }; streams.push(s); return { cancel() { s.cancelled = true; } }; }, answer: async (id, value) => { answered.push([id, value]); }, close() {} };
  const answered = [];
  const calls = [];
  const call = async (endpoint, args) => {
    calls.push([endpoint, args]);
    if (endpoint === 'session/list') return { items: rows };
    if (endpoint === 'session/projections') return { asOfSeq: 20, values: {} };
    if (endpoint === 'session/page') return { records: pages[args.request.address.sessionId] ?? [] };
    if (endpoint === 'session/create') { rows.push(row('s-new', { agentAvailable: true })); return { sessionId: 's-new', agentPreset: 'gravit' }; }
    return undefined;
  };
  const getJson = async path => (path === '/data/channels.json' ? { ok: true, root: '/r', channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true, sessionIds: [] }], ungrouped: [], archived: [], presets: {} } : { bots: [] });
  const posted = [];
  const postJson = async (path, body) => { posted.push([path, body]); return { addressed: [] }; };
  return { openMux: o => { opts = o; return mux; }, call, getJson, postJson, markdown: null, calls, posted, answered, streams, ready: async () => { opts.onReady({}); await settle(); }, opts: () => opts };
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
  f.withSelector('input[name="q-q1"]', { checked: true, value: 'Yes, pin it' });
  f.click({ tagName: 'BUTTON', dataset: { action: 'answerQuestion', conv: 's1', msg: 'ev-2' } });
  await settle();
  assert.deepEqual(h.answered[1], ['ev-2', { answers: [{ id: 'q1', selected: ['Yes, pin it'] }] }]);
  assert.match(f.html(), />Answered</);
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
