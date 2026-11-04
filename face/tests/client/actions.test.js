// Actions (spec 2026-10-19 §5): a data-action becomes exactly the Remote the old client sent, with its wire shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { makeActions } from '../../client/js/host/actions.js';

const conv = (id, over = {}) => ({ id, title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });

// a store on screen at conversation `id`, a recording host whose answers are canned per endpoint
function rig({ answers = {}, posts = {}, convs = [conv('s1')], open = 's1', activate } = {}) {
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
  const opened = activate ? async id => { calls.push(['activate', id]); return activate(id); } : undefined;
  const actions = makeActions({ store, call, answerGate, postJson, requestId: () => 'req-1', timeZone: () => 'Asia/Shanghai', activate: opened });
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
  assert.equal(out.store.get().status.line, 'Not signed in — open the URL gravit-face printed');
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

test('pin and unpin send their remotes and set the pin set from the answer', async () => {
  const r = rig({ answers: { 'workspace/pinSession': a => ({ pinnedSessionIds: ['x', a.request.sessionId] }), 'workspace/unpinSession': () => ({ pinnedSessionIds: ['x'] }) } });
  assert.equal(await r.actions.pin('s1'), true);
  assert.deepEqual(r.store.get().pinned, ['x', 's1']);
  assert.equal(await r.actions.unpin('s1'), true);
  assert.deepEqual(r.store.get().pinned, ['x']);
  assert.deepEqual(r.calls, [['workspace/pinSession', { request: { sessionId: 's1' } }], ['workspace/unpinSession', { request: { sessionId: 's1' } }]]);
});

test('a failed pin says so on the status line and changes nothing', async () => {
  const r = rig({ answers: { 'workspace/pinSession': err({ code: 'x' }) } });
  r.store.dispatch('hostPins', ['x']);
  assert.equal(await r.actions.pin('s1'), false);
  assert.deepEqual(r.store.get().pinned, ['x']);
  assert.equal(r.store.get().status.line, 'Pin failed. Try again later.');
  assert.equal(r.store.get().status.bad, true);
});

test('archiving a pinned conversation unpins it after the archive succeeds; a failed archive unpins nothing', async () => {
  const r = rig({ answers: { 'workspace/unpinSession': () => ({ pinnedSessionIds: [] }) } });
  r.store.dispatch('hostPins', ['s1']);
  assert.equal(await r.actions.archive('s1', true), true);
  assert.deepEqual(r.calls, [['workspace/unpinSession', { request: { sessionId: 's1' } }]]);
  assert.deepEqual(r.store.get().pinned, []);
  const bad = rig({ posts: { '/data/sessions/archive': err({ status: 500 }) } });
  bad.store.dispatch('hostPins', ['s1']);
  assert.equal(await bad.actions.archive('s1', true), false);
  assert.deepEqual(bad.calls, []);
  assert.deepEqual(bad.store.get().pinned, ['s1']);
  const un = rig();
  un.store.dispatch('hostPins', ['s1']);
  await un.actions.archive('s1', false);
  assert.deepEqual(un.calls, []);
});

// ---- plan 3 task 8: a command on a cold conversation, runCommand, and send's room option
test('a slash line on a cold conversation opens it before commands/execute', async () => {
  const r = rig({ convs: [conv('s1', { live: false })], activate: () => true, answers: { 'commands/execute': { result: { kind: 'ok', text: 'compacted' } } } });
  assert.deepEqual(await r.actions.send('/compact'), { sent: 'command', sessionId: 's1' });
  assert.deepEqual(r.calls.map(c => c[0]), ['activate', 'commands/execute']);
  assert.equal(r.calls[0][1], 's1');
});

test('a conversation that does not open sends nothing and says so', async () => {
  const r = rig({ convs: [conv('s1', { live: false })], activate: () => false });
  assert.equal(await r.actions.send('/compact'), null);
  assert.deepEqual(r.calls.map(c => c[0]), ['activate'], 'neither the command nor a prompt');
  assert.deepEqual(r.store.get().status.line, 'send: the conversation did not open');
  assert.equal(r.store.get().status.bad, true);
});

test("runCommand says the command's result, or its failure", async () => {
  const ok = rig({ answers: { 'commands/execute': { result: { kind: 'ok', text: 'compacted' } } } });
  assert.equal(await ok.actions.runCommand('s1', '/compact'), true);
  assert.deepEqual(ok.calls, [['commands/execute', { agentId: 's1', line: '/compact', submittedAttachments: [] }]]);
  assert.equal(ok.store.get().status.line, 'compacted');
  const refused = rig({ answers: { 'commands/execute': err({ code: 'gateway/lookup-not-found' }) } });
  assert.equal(await refused.actions.runCommand('s1', '/compact'), false);
  assert.equal(refused.store.get().status.line, 'command: gateway/lookup-not-found');
  assert.equal(refused.store.get().status.bad, true);
  const cold = rig({ activate: () => false });
  assert.equal(await cold.actions.runCommand('s1', '/compact'), false);
  assert.equal(cold.store.get().status.line, 'command: the conversation did not open');
  assert.equal(cold.calls.some(c => c[0] === 'commands/execute'), false);
});

test('runCommand says so when no command claims the line', async () => {
  const none = rig({ answers: { 'commands/execute': null } });
  assert.equal(await none.actions.runCommand('s1', '/compact'), true);
  assert.equal(none.store.get().status.line, 'no command claimed /compact');
});

test('room: false sends a line with @ straight to Gravit; true posts it to the room', async () => {
  const inRoom = { convs: [conv('s1', { channel: { workspaceId: 'w1', name: 'alpha' } })], posts: { '/data/rooms/say': { addressed: ['buffett'] } } };
  const direct = rig(inRoom);
  assert.deepEqual(await direct.actions.send('read @strategies/x.md', { room: false }), { sent: 'prompt', sessionId: 's1' });
  assert.equal(direct.posted.length, 0);
  assert.equal(direct.calls[0][1].request.content[0].text, 'read @strategies/x.md');
  const room = rig(inRoom);
  assert.deepEqual(await room.actions.send('plain words', { room: true }), { sent: 'say', sessionId: 's1' });
  assert.deepEqual(room.posted, [['/data/rooms/say', { sessionId: 's1', text: 'plain words' }]]);
  const outside = rig({ posts: inRoom.posts });
  await outside.actions.send('plain words', { room: true });
  assert.equal(outside.posted.length, 0, 'no channel, no room');
});

// ---- attachments (plan 4 task 6) ----
const imagePart = { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'shot.png' };
const filePart = { type: 'file', receiptId: 'r-1' };
const refusedFor = reason => err({ code: 'session/attachment-invalid', details: { reason } });

test('a prompt with attachments sends the text part, then the parts in order; an image-only prompt sends no text part', async () => {
  const r = rig();
  assert.deepEqual(await r.actions.send(' read these ', { attachments: [filePart, imagePart] }), { sent: 'prompt', sessionId: 's1' });
  assert.deepEqual(r.calls[0][1].request.content, [{ type: 'text', text: 'read these' }, filePart, imagePart]);
  const only = rig();
  assert.deepEqual(await only.actions.send('   ', { attachments: [imagePart] }), { sent: 'prompt', sessionId: 's1' });
  assert.deepEqual(only.calls[0][1].request.content, [imagePart]);
  const none = rig();
  assert.equal(await none.actions.send('  ', { attachments: [] }), null);
  assert.equal(none.calls.length, 0);
});

test('a slash line with attachments sends them as submittedAttachments', async () => {
  const r = rig({ answers: { 'commands/execute': { result: { kind: 'ok', text: 'goal set' } } } });
  assert.deepEqual(await r.actions.send('/goal read the file', { attachments: [filePart] }), { sent: 'command', sessionId: 's1' });
  assert.deepEqual(r.calls, [['commands/execute', { agentId: 's1', line: '/goal read the file', submittedAttachments: [filePart] }]]);
  const unclaimed = rig({ answers: { 'commands/execute': undefined } });
  await unclaimed.actions.send('/nothing', { attachments: [filePart] });
  assert.deepEqual(unclaimed.calls[1][1].request.content, [{ type: 'text', text: '/nothing' }, filePart], 'an unclaimed line prompts with its files');
});

test('with attachments the room is never tried, even for a line with @', async () => {
  const inRoom = { convs: [conv('s1', { channel: { workspaceId: 'w1', name: 'alpha' } })], posts: { '/data/rooms/say': { addressed: ['buffett'] } } };
  const r = rig(inRoom);
  assert.deepEqual(await r.actions.send('@buffett look', { attachments: [filePart] }), { sent: 'prompt', sessionId: 's1' });
  const forced = rig(inRoom);
  assert.deepEqual(await forced.actions.send('look', { room: true, attachments: [filePart] }), { sent: 'prompt', sessionId: 's1' });
  assert.equal(r.posted.length + forced.posted.length, 0);
});

test('an attachment refusal goes to attachmentRefused with its reason and says nothing else', async () => {
  const r = rig({ answers: { 'session/prompt': refusedFor('MODEL_DOES_NOT_SUPPORT_IMAGES') } });
  const reasons = [];
  assert.equal(await r.actions.send('look', { attachments: [imagePart], attachmentRefused: why => reasons.push(why) }), null);
  assert.deepEqual(reasons, ['MODEL_DOES_NOT_SUPPORT_IMAGES']);
  assert.equal(r.store.get().status.line, emptyState().status.line, 'no send: line');
  const bare = rig({ answers: { 'session/prompt': refusedFor('FILE_NOT_STAGED') } });
  assert.equal(await bare.actions.send('look', { attachments: [filePart] }), null);
  assert.equal(bare.store.get().status.line, 'send: session/attachment-invalid (FILE_NOT_STAGED)');
  assert.equal(bare.store.get().status.bad, true);
  const other = rig({ answers: { 'session/prompt': err({ code: 'session/busy' }) } });
  const none = [];
  await other.actions.send('look', { attachments: [filePart], attachmentRefused: why => none.push(why) });
  assert.deepEqual(none, [], 'only the attachment code goes to the callback');
  assert.equal(other.store.get().status.line, 'send: session/busy');
});

test('newConversationWith creates, reports the id, prepares and prompts; a refused prompt answers the id with sent false', async () => {
  const r = rig({ answers: { 'session/create': { sessionId: 's-new' } } });
  const seen = [];
  const got = await r.actions.newConversationWith({
    title: 'Look', workspaceId: 'w1', text: 'read it',
    onCreated: id => seen.push(['created', id, r.calls.length]),
    prepare: async id => { seen.push(['prepare', id]); return [filePart]; },
  });
  assert.deepEqual(got, { id: 's-new', sent: true });
  assert.deepEqual(seen, [['created', 's-new', 1], ['prepare', 's-new']], 'created right after the create, before the rename and the prompt');
  assert.deepEqual(r.calls.map(c => c[0]), ['session/create', 'session/rename', 'session/prompt']);
  assert.deepEqual(r.calls[2][1].request.content, [{ type: 'text', text: 'read it' }, filePart]);
  const notUp = rig({ answers: { 'session/create': { sessionId: 's-2' } } });
  assert.deepEqual(await notUp.actions.newConversationWith({ text: 'x', prepare: async () => null }), { id: 's-2', sent: false });
  assert.deepEqual(notUp.calls.map(c => c[0]), ['session/create'], 'files not up: no prompt');
  const refused = rig({ answers: { 'session/create': { sessionId: 's-3' }, 'session/prompt': refusedFor('MODEL_DOES_NOT_SUPPORT_IMAGES') } });
  const why = [];
  assert.deepEqual(await refused.actions.newConversationWith({ text: '', prepare: async () => [imagePart], attachmentRefused: x => why.push(x) }), { id: 's-3', sent: false });
  assert.deepEqual(why, ['MODEL_DOES_NOT_SUPPORT_IMAGES']);
  assert.deepEqual(refused.calls[1][1].request.content, [imagePart]);
  const failed = rig({ answers: { 'session/create': err({ code: 'boom' }) } });
  assert.deepEqual(await failed.actions.newConversationWith({ text: 'x' }), { id: null, sent: false });
  assert.equal(failed.store.get().status.line, 'new message: boom');
});

test('newConversation still answers an id or null', async () => {
  const r = rig({ answers: { 'session/create': { sessionId: 's-new' } } });
  assert.equal(await r.actions.newConversation({ title: '', workspaceId: null, text: 'hi' }), 's-new');
  const refused = rig({ answers: { 'session/create': { sessionId: 's-4' }, 'session/prompt': err({ code: 'session/busy' }) } });
  assert.equal(await refused.actions.newConversation({ text: 'hi' }), null, 'a failure after the create answers null, as before');
  const failed = rig({ answers: { 'session/create': err({ code: 'boom' }) } });
  assert.equal(await failed.actions.newConversation({ text: 'hi' }), null);
});

test('newConversationWith reports the id before the rename, so a failed rename keeps the draft with the conversation', async () => {
  const r = rig({ answers: { 'session/create': { sessionId: 's-new' }, 'session/rename': err({ code: 'rename/failed' }) } });
  const seen = [];
  const got = await r.actions.newConversationWith({ title: 'Look', text: 'x', onCreated: id => seen.push([id, r.calls.length]), prepare: async () => [] });
  assert.deepEqual(got, { id: 's-new', sent: false });
  assert.deepEqual(seen, [['s-new', 1]], 'told right after the create');
  assert.equal(r.store.get().status.line, 'new message: rename/failed');
});

test('a command that settles as an error with attachments is a refusal; a dropped receipt goes to attachmentRefused', async () => {
  const noFiles = rig({ answers: { 'commands/execute': { result: { kind: 'error', text: '/compact does not accept attachments' } } } });
  const why = [];
  assert.equal(await noFiles.actions.send('/compact', { attachments: [filePart], attachmentRefused: x => why.push(x) }), null);
  assert.equal(noFiles.store.get().status.line, '/compact does not accept attachments');
  assert.equal(noFiles.store.get().status.bad, true);
  assert.deepEqual(why, []);
  const dropped = rig({ answers: { 'commands/execute': { result: { kind: 'error', text: 'File upload receipt is unknown for this session.' } } } });
  assert.equal(await dropped.actions.send('/goal x', { attachments: [filePart], attachmentRefused: x => why.push(x) }), null);
  assert.deepEqual(why, ['ATTACHMENT_NOT_FOUND']);
  const plain = rig({ answers: { 'commands/execute': { result: { kind: 'error', text: 'no goal' } } } });
  assert.deepEqual(await plain.actions.send('/goal resume'), { sent: 'command', sessionId: 's1' }, 'with no files an error result is still the command\'s answer');
});
