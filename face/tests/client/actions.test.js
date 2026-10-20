// Actions (spec 2026-10-19 §5): a data-action becomes exactly the Remote the old client sent, with its wire shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { makeActions, NOT_SIGNED_IN } from '../../client/js/host/actions.js';

const conv = (id, over = {}) => ({ id, title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });

// a store on screen at conversation `id`, a recording host whose answers are canned per endpoint
function rig({ answers = {}, posts = {}, convs = [conv('s1')], open = 's1' } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  store.dispatch('hostList', { conversations: convs });
  store.dispatch('nav', { screen: 'messages', id: open });
  const calls = [];
  const call = async (endpoint, args) => {
    calls.push([endpoint, args]);
    const a = answers[endpoint];
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(args) : a;
  };
  const posted = [];
  const postJson = async (path, body) => { posted.push([path, body]); const a = posts[path]; if (a instanceof Error) throw a; return a ?? {}; };
  const answered = [];
  const answerGate = async (eventId, value) => { answered.push([eventId, value]); if (answers.$answer instanceof Error) throw answers.$answer; };
  const actions = makeActions({ store, call, answerGate, postJson, requestId: () => 'req-1', timeZone: () => 'Asia/Shanghai' });
  return { store, actions, calls, posted, answered };
}
const err = (over) => Object.assign(new Error('boom'), over);

test('a plain send is one session/prompt in queue mode with a minted requestId and the zone', async () => {
  const r = rig();
  assert.deepEqual(await r.actions.send('  look at ETH  '), { sent: 'prompt', sessionId: 's1' });
  assert.deepEqual(r.calls, [['session/prompt', { request: { requestId: 'req-1', sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'look at ETH' }], clientTimeZone: 'Asia/Shanghai' } }]]);
  assert.equal(await r.actions.send('   '), null);
  assert.equal(r.calls.length, 1);
});

test('a slash line goes to commands/execute first; only an unclaimed line continues as a prompt', async () => {
  const claimed = rig({ answers: { 'commands/execute': { result: { kind: 'ok', text: 'goal resumed' } } } });
  assert.deepEqual(await claimed.actions.send('/goal resume'), { sent: 'command', sessionId: 's1' });
  assert.deepEqual(claimed.calls, [['commands/execute', { agentId: 's1', line: '/goal resume', submittedAttachments: [] }]]);
  assert.equal(claimed.store.get().status.line, 'goal resumed');
  const unclaimed = rig({ answers: { 'commands/execute': undefined } });
  assert.deepEqual(await unclaimed.actions.send('/nothing'), { sent: 'prompt', sessionId: 's1' });
  assert.deepEqual(unclaimed.calls.map(c => c[0]), ['commands/execute', 'session/prompt']);
});

test('an @ in a channel conversation goes to the room first; nobody addressed means an ordinary prompt', async () => {
  const room = rig({ convs: [conv('s1', { channel: { workspaceId: 'w1', name: 'alpha' } })], posts: { '/data/rooms/say': { addressed: ['buffett'] } } });
  assert.deepEqual(await room.actions.send('@buffett leverage?'), { sent: 'say', sessionId: 's1' });
  assert.deepEqual(room.posted, [['/data/rooms/say', { sessionId: 's1', text: '@buffett leverage?' }]]);
  assert.equal(room.calls.length, 0);
  const nobody = rig({ convs: [conv('s1', { channel: { workspaceId: 'w1', name: 'alpha' } })], posts: { '/data/rooms/say': { addressed: [] } } });
  assert.deepEqual(await nobody.actions.send('@nobody hi'), { sent: 'prompt', sessionId: 's1' });
  assert.equal(nobody.calls[0][0], 'session/prompt');
  const plain = rig();
  await plain.actions.send('@buffett hi');
  assert.equal(plain.posted.length, 0, 'outside a channel an @ is just text');
});

test('a new conversation is create, rename, prompt in that order, and its id comes back', async () => {
  const r = rig({ answers: { 'session/create': { sessionId: 's-new', agentPreset: 'gravit' } } });
  assert.equal(await r.actions.newConversation({ title: ' BTC under 70k ', workspaceId: 'w1', text: 'Buy a little' }), 's-new');
  assert.deepEqual(r.calls.map(c => c[0]), ['session/create', 'session/rename', 'session/prompt']);
  assert.deepEqual(r.calls[0][1], { request: { workspaceId: 'w1' } });
  assert.deepEqual(r.calls[1][1], { request: { sessionId: 's-new', title: 'BTC under 70k' } });
  assert.equal(r.calls[2][1].request.sessionId, 's-new');
  const bare = rig({ answers: { 'session/create': { sessionId: 's-2' } } });
  await bare.actions.newConversation({ title: '', workspaceId: null, text: 'hi' });
  assert.deepEqual(bare.calls.map(c => c[0]), ['session/create', 'session/prompt']);
  assert.deepEqual(bare.calls[0][1], { request: {} });
});

test('stop cancels the session and says how a paused goal comes back; rename renames', async () => {
  const r = rig();
  await r.actions.stop('s1');
  assert.deepEqual(r.calls, [['session/cancel', { request: { sessionId: 's1' } }]]);
  assert.equal(r.store.get().status.line, 'Stopped. A paused goal resumes with /goal resume');
  await r.actions.rename('s1', ' New words ');
  assert.deepEqual(r.calls[1], ['session/rename', { request: { sessionId: 's1', title: 'New words' } }]);
  await r.actions.rename('s1', '  ');
  assert.equal(r.calls.length, 2);
});

test('an answer goes through the mux and marks the card with this tab\'s outcome; a refused answer reaches the status line', async () => {
  const r = rig();
  r.store.dispatch('hostGate', { convId: 's1', message: { id: 'ev-1', at: 1, from: 'gravit', kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 's1', toolName: 'mcp__x__place_order' } } });
  assert.equal(await r.actions.answer('ev-1', 'allowed-once'), true);
  assert.deepEqual(r.answered, [['ev-1', 'allowed-once']]);
  assert.equal(r.store.get().conversations[0].messages.find(m => m.id === 'ev-1').answer, 'approved');
  const refused = rig({ answers: { $answer: err({ code: 'not-pending' }) } });
  assert.equal(await refused.actions.answer('ev-9', 'rejected'), false);
  assert.match(refused.store.get().status.line, /not-pending/);
  assert.equal(refused.store.get().status.bad, true);
});

test('a second press while the first answer is in flight sends nothing: one answer per gate, and no red line over an approval that stood', async () => {
  const r = rig();
  r.store.dispatch('hostGate', { convId: 's1', message: { id: 'ev-1', at: 1, from: 'gravit', kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 's1', toolName: 'mcp__x__place_order' } } });
  const first = r.actions.answer('ev-1', 'allowed-once');
  const second = r.actions.answer('ev-1', 'allowed-once');
  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.deepEqual(r.answered, [['ev-1', 'allowed-once']], 'the mux saw one answer');
  assert.equal(r.store.get().conversations[0].messages.find(m => m.id === 'ev-1').answer, 'approved');
  assert.equal(r.store.get().status.bad, false);
});

test('a 401 says to open the printed URL; a business failure names the host\'s code', async () => {
  const out = rig({ answers: { 'session/prompt': err({ status: 401 }) } });
  assert.equal(await out.actions.send('hi'), null);
  assert.equal(out.store.get().status.line, NOT_SIGNED_IN);
  assert.equal(out.store.get().status.bad, true);
  const gone = rig({ answers: { 'session/prompt': err({ code: 'session/not-found' }) } });
  await gone.actions.send('hi');
  assert.match(gone.store.get().status.line, /session\/not-found/);
});

test('fork returns the new id; a second press while one is in flight sends nothing', async () => {
  let release;
  const r = rig({ answers: { 'session/fork': () => new Promise(res => { release = () => res({ sessionId: 's-fork' }); }) } });
  const first = r.actions.fork('s1');
  assert.equal(await r.actions.fork('s1'), null, 'the second press is refused while the first is in flight');
  release();
  assert.equal(await first, 's-fork');
  assert.deepEqual(r.calls.filter(c => c[0] === 'session/fork'), [['session/fork', { request: { sessionId: 's1' } }]]);
  const bad = rig({ answers: { 'session/fork': err({ code: 'session/fork-unavailable' }) } });
  assert.equal(await bad.actions.fork('s1'), null);
  assert.equal(bad.store.get().status.line, 'fork: session/fork-unavailable');
});

test('archive and un-archive post the explicit boolean', async () => {
  const r = rig();
  assert.equal(await r.actions.archive('s1', true), true);
  assert.equal(await r.actions.archive('s1', false), true);
  assert.deepEqual(r.posted, [['/data/sessions/archive', { sessionId: 's1', archived: true }], ['/data/sessions/archive', { sessionId: 's1', archived: false }]]);
});

test('archive refuses a running conversation or one with a waiting card, without calling', async () => {
  const card = { id: 'ev-1', seq: 1.5, at: 1, from: 'gravit', kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 's1' } };
  const running = rig({ convs: [conv('s1', { running: true })] });
  assert.equal(await running.actions.archive('s1', true), false);
  assert.equal(running.store.get().status.line, 'Stop Gravit first');
  const waiting = rig({ convs: [conv('s1', { messages: [card] })] });
  assert.equal(await waiting.actions.archive('s1', true), false);
  assert.equal(waiting.store.get().status.line, 'Answer the waiting card first');
  assert.deepEqual([...running.posted, ...waiting.posted], []);
});

test('delete posts; a running conversation is refused without calling', async () => {
  const r = rig();
  assert.equal(await r.actions.remove('s1'), true);
  assert.deepEqual(r.posted, [['/data/sessions/delete', { sessionId: 's1' }]]);
  const busy = rig({ convs: [conv('s1', { running: true })] });
  assert.equal(await busy.actions.remove('s1'), false);
  assert.deepEqual(busy.posted, []);
  assert.equal(busy.store.get().status.line, 'Stop Gravit first');
});

test("a 409 on un-archive puts the route's words on the status line", async () => {
  const words = 'this session was archived by the host: the face does not un-archive host archives';
  const r = rig({ posts: { '/data/sessions/archive': err({ status: 409, code: words, message: words }) } });
  assert.equal(await r.actions.archive('s1', false), false);
  assert.equal(r.store.get().status.line, `un-archive: ${words}`);
  assert.equal(r.store.get().status.bad, true);
});

test("talkTo opens the bot's newest open home conversation, else creates one in its home with its preset", async () => {
  const bot = { id: 'buffett', homeCwd: '/r/bots/buffett/home' };
  const convs = [conv('h-old', { kind: 'bot', preset: 'buffett', updatedAt: 3 }), conv('h-new', { kind: 'bot', preset: 'buffett', updatedAt: 9 }), conv('h-arch', { kind: 'bot', preset: 'buffett', updatedAt: 99, archived: 'face' }), conv('s1')];
  const r = rig({ convs });
  assert.deepEqual(await r.actions.talkTo(bot), { id: 'h-new' });
  assert.deepEqual(r.calls, [], 'an open home conversation needs no call');
  const fresh = rig({ answers: { 'session/create': { sessionId: 's-home', agentPreset: 'buffett' } } });
  assert.deepEqual(await fresh.actions.talkTo(bot), { id: 's-home' });
  assert.deepEqual(fresh.calls, [['session/create', { request: { cwd: '/r/bots/buffett/home', agentPreset: 'buffett' } }]]);
  const down = rig({ answers: { 'session/create': err({ code: 'preset/broken' }) } });
  assert.deepEqual(await down.actions.talkTo(bot), { error: 'talk to: preset/broken' });
});

test('stopChild sends interruptByParent in continuable mode', async () => {
  const r = rig({ answers: { 'subagents/interruptByParent': { accepted: true } } });
  assert.equal(await r.actions.stopChild('p', 'c1', 'Check'), true);
  assert.deepEqual(r.calls, [['subagents/interruptByParent', { childSessionId: 'c1', parentSessionId: 'p', mode: 'continuable' }]]);
  assert.equal(r.store.get().status.line, 'Stopping Check');
  const no = rig({ answers: { 'subagents/interruptByParent': err({ code: 'subagent/not-found' }) } });
  assert.equal(await no.actions.stopChild('p', 'c1', 'Check'), false);
  assert.equal(no.store.get().status.line, 'stop: subagent/not-found');
});
