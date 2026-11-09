// Actions (spec 2026-10-19 §5): a data-action becomes exactly the Remote the old client sent, with its wire shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { makeActions } from '../../client/js/host/actions.js';
import { sayOf } from '../../client/js/i18n/words.js';

const conv = (id, over = {}) => ({ id, title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });

// a store on Messages with `open` the conversation, a recording host whose answers are canned per endpoint
function rig({ answers = {}, posts = {}, convs = [conv('s1')], open = 's1', activate } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  store.dispatch('hostList', { conversations: convs });
  store.dispatch('tasksLoaded', { conversation: open, tasks: [], at: 1 });
  store.dispatch('nav', { screen: 'messages', id: null });
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
  const actions = makeActions({ store, call, answerGate, requestId: () => 'req-1', timeZone: () => 'Asia/Shanghai', activate: opened });
  return { store, actions, calls, posted, answered };
}
const err = (over) => Object.assign(new Error('boom'), over);

test('send prompts the session it is given, in queue mode', async () => {
  // the one conversation is the caller's to name (app.js): not the route's, and never a room's
  const r = rig({ convs: [conv('s1', { channel: { workspaceId: 'w1', name: 'alpha' } }), conv('c9')], posts: { '/data/rooms/say': { addressed: ['buffett'] } } });
  assert.deepEqual(await r.actions.send('@buffett look', { sessionId: 'c9' }), { sent: 'prompt', sessionId: 'c9' });
  assert.deepEqual(r.calls, [['session/prompt', { request: { requestId: 'req-1', sessionId: 'c9', mode: 'queue', content: [{ type: 'text', text: '@buffett look' }], clientTimeZone: 'Asia/Shanghai' } }]]);
  assert.equal(r.posted.length, 0, 'no room is tried');
  // one the list does not carry yet still takes it; no session named sends nothing
  assert.deepEqual(await r.actions.send('hi', { sessionId: 'fresh' }), { sent: 'prompt', sessionId: 'fresh' });
  assert.equal(await r.actions.send('hi'), null);
  assert.equal(await r.actions.send('hi', { sessionId: '' }), null);
  assert.equal(r.calls.length, 2);
});

test('a plain send is one session/prompt in queue mode with a minted requestId and the zone', async () => {
  const r = rig();
  assert.deepEqual(await r.actions.send('  look at ETH  ', { sessionId: 's1', sessionId: 's1' }), { sent: 'prompt', sessionId: 's1' });
  assert.deepEqual(r.calls, [['session/prompt', { request: { requestId: 'req-1', sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'look at ETH' }], clientTimeZone: 'Asia/Shanghai' } }]]);
  assert.equal(await r.actions.send('   ', { sessionId: 's1', sessionId: 's1' }), null);
  assert.equal(r.calls.length, 1);
});

test('a slash line goes to commands/execute first; only an unclaimed line continues as a prompt', async () => {
  const claimed = rig({ answers: { 'commands/execute': { result: { kind: 'ok', text: 'goal resumed' } } } });
  assert.deepEqual(await claimed.actions.send('/goal resume', { sessionId: 's1', sessionId: 's1' }), { sent: 'command', sessionId: 's1' });
  assert.deepEqual(claimed.calls, [['commands/execute', { agentId: 's1', line: '/goal resume', submittedAttachments: [] }]]);
  assert.equal(sayOf(claimed.store.get().status.line), 'goal resumed');
  const unclaimed = rig({ answers: { 'commands/execute': undefined } });
  assert.deepEqual(await unclaimed.actions.send('/nothing', { sessionId: 's1', sessionId: 's1' }), { sent: 'prompt', sessionId: 's1' });
  assert.deepEqual(unclaimed.calls.map(c => c[0]), ['commands/execute', 'session/prompt']);
});

test('stop cancels the session and says how a paused goal comes back', async () => {
  const r = rig();
  await r.actions.stop('s1');
  assert.deepEqual(r.calls, [['session/cancel', { request: { sessionId: 's1' } }]]);
  assert.equal(sayOf(r.store.get().status.line), 'Stopped. A paused goal resumes with /goal resume');
});

test('an answer goes through the mux and marks the card with this tab\'s outcome; a refused answer reaches the status line', async () => {
  const r = rig();
  r.store.dispatch('hostGate', { convId: 's1', message: { id: 'ev-1', at: 1, from: 'gravit', kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 's1', toolName: 'mcp__x__place_order' } } });
  assert.equal(await r.actions.answer('ev-1', 'allowed-once'), true);
  assert.deepEqual(r.answered, [['ev-1', 'allowed-once']]);
  assert.equal(r.store.get().conversations[0].messages.find(m => m.id === 'ev-1').answer, 'approved');
  const refused = rig({ answers: { $answer: err({ code: 'not-pending' }) } });
  assert.equal(await refused.actions.answer('ev-9', 'rejected'), false);
  assert.match(sayOf(refused.store.get().status.line), /not-pending/);
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
  assert.equal(await out.actions.send('hi', { sessionId: 's1', sessionId: 's1' }), null);
  assert.equal(sayOf(out.store.get().status.line), 'Not signed in — open the URL gravit-face printed');
  assert.equal(out.store.get().status.bad, true);
  const gone = rig({ answers: { 'session/prompt': err({ code: 'session/not-found' }) } });
  await gone.actions.send('hi', { sessionId: 's1', sessionId: 's1' });
  assert.match(sayOf(gone.store.get().status.line), /session\/not-found/);
});

test('stopChild sends interruptByParent in continuable mode', async () => {
  const r = rig({ answers: { 'subagents/interruptByParent': { accepted: true } } });
  assert.equal(await r.actions.stopChild('p', 'c1', 'Check'), true);
  assert.deepEqual(r.calls, [['subagents/interruptByParent', { childSessionId: 'c1', parentSessionId: 'p', mode: 'continuable' }]]);
  assert.equal(sayOf(r.store.get().status.line), 'Stopping Check');
  const no = rig({ answers: { 'subagents/interruptByParent': err({ code: 'subagent/not-found' }) } });
  assert.equal(await no.actions.stopChild('p', 'c1', 'Check'), false);
  assert.equal(sayOf(no.store.get().status.line), 'stop: subagent/not-found');
});

// ---- plan 3 task 8: a command on a cold conversation, runCommand
test('a slash line on a cold conversation opens it before commands/execute', async () => {
  const r = rig({ convs: [conv('s1', { live: false })], activate: () => true, answers: { 'commands/execute': { result: { kind: 'ok', text: 'compacted' } } } });
  assert.deepEqual(await r.actions.send('/compact', { sessionId: 's1', sessionId: 's1' }), { sent: 'command', sessionId: 's1' });
  assert.deepEqual(r.calls.map(c => c[0]), ['activate', 'commands/execute']);
  assert.equal(r.calls[0][1], 's1');
});

test('a conversation that does not open sends nothing and says so', async () => {
  const r = rig({ convs: [conv('s1', { live: false })], activate: () => false });
  assert.equal(await r.actions.send('/compact', { sessionId: 's1', sessionId: 's1' }), null);
  assert.deepEqual(r.calls.map(c => c[0]), ['activate'], 'neither the command nor a prompt');
  assert.deepEqual(sayOf(r.store.get().status.line), 'send: the conversation did not open');
  assert.equal(r.store.get().status.bad, true);
});

test("runCommand says the command's result, or its failure", async () => {
  const ok = rig({ answers: { 'commands/execute': { result: { kind: 'ok', text: 'compacted' } } } });
  assert.equal(await ok.actions.runCommand('s1', '/compact'), true);
  assert.deepEqual(ok.calls, [['commands/execute', { agentId: 's1', line: '/compact', submittedAttachments: [] }]]);
  assert.equal(sayOf(ok.store.get().status.line), 'compacted');
  const refused = rig({ answers: { 'commands/execute': err({ code: 'gateway/lookup-not-found' }) } });
  assert.equal(await refused.actions.runCommand('s1', '/compact'), false);
  assert.equal(sayOf(refused.store.get().status.line), 'command: gateway/lookup-not-found');
  assert.equal(refused.store.get().status.bad, true);
  const cold = rig({ activate: () => false });
  assert.equal(await cold.actions.runCommand('s1', '/compact'), false);
  assert.equal(sayOf(cold.store.get().status.line), 'command: the conversation did not open');
  assert.equal(cold.calls.some(c => c[0] === 'commands/execute'), false);
});

test('runCommand says so when no command claims the line', async () => {
  const none = rig({ answers: { 'commands/execute': null } });
  assert.equal(await none.actions.runCommand('s1', '/compact'), true);
  assert.equal(sayOf(none.store.get().status.line), 'no command claimed /compact');
});

// ---- attachments (plan 4 task 6) ----
const imagePart = { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'shot.png' };
const filePart = { type: 'file', receiptId: 'r-1' };
const refusedFor = reason => err({ code: 'session/attachment-invalid', details: { reason } });

test('a prompt with attachments sends the text part, then the parts in order; an image-only prompt sends no text part', async () => {
  const r = rig();
  assert.deepEqual(await r.actions.send(' read these ', { sessionId: 's1', attachments: [filePart, imagePart] }), { sent: 'prompt', sessionId: 's1' });
  assert.deepEqual(r.calls[0][1].request.content, [{ type: 'text', text: 'read these' }, filePart, imagePart]);
  const only = rig();
  assert.deepEqual(await only.actions.send('   ', { sessionId: 's1', attachments: [imagePart] }), { sent: 'prompt', sessionId: 's1' });
  assert.deepEqual(only.calls[0][1].request.content, [imagePart]);
  const none = rig();
  assert.equal(await none.actions.send('  ', { sessionId: 's1', attachments: [] }), null);
  assert.equal(none.calls.length, 0);
});

test('a slash line with attachments sends them as submittedAttachments', async () => {
  const r = rig({ answers: { 'commands/execute': { result: { kind: 'ok', text: 'goal set' } } } });
  assert.deepEqual(await r.actions.send('/goal read the file', { sessionId: 's1', attachments: [filePart] }), { sent: 'command', sessionId: 's1' });
  assert.deepEqual(r.calls, [['commands/execute', { agentId: 's1', line: '/goal read the file', submittedAttachments: [filePart] }]]);
  const unclaimed = rig({ answers: { 'commands/execute': undefined } });
  await unclaimed.actions.send('/nothing', { sessionId: 's1', attachments: [filePart] });
  assert.deepEqual(unclaimed.calls[1][1].request.content, [{ type: 'text', text: '/nothing' }, filePart], 'an unclaimed line prompts with its files');
});

test('an attachment refusal goes to attachmentRefused with its reason and says nothing else', async () => {
  const r = rig({ answers: { 'session/prompt': refusedFor('MODEL_DOES_NOT_SUPPORT_IMAGES') } });
  const reasons = [];
  assert.equal(await r.actions.send('look', { sessionId: 's1', attachments: [imagePart], attachmentRefused: why => reasons.push(why) }), null);
  assert.deepEqual(reasons, ['MODEL_DOES_NOT_SUPPORT_IMAGES']);
  assert.equal(sayOf(r.store.get().status.line), sayOf(emptyState().status.line), 'no send: line');
  const bare = rig({ answers: { 'session/prompt': refusedFor('FILE_NOT_STAGED') } });
  assert.equal(await bare.actions.send('look', { sessionId: 's1', attachments: [filePart] }), null);
  assert.equal(sayOf(bare.store.get().status.line), 'send: session/attachment-invalid (FILE_NOT_STAGED)');
  assert.equal(bare.store.get().status.bad, true);
  const other = rig({ answers: { 'session/prompt': err({ code: 'session/busy' }) } });
  const none = [];
  await other.actions.send('look', { sessionId: 's1', attachments: [filePart], attachmentRefused: why => none.push(why) });
  assert.deepEqual(none, [], 'only the attachment code goes to the callback');
  assert.equal(sayOf(other.store.get().status.line), 'send: session/busy');
});

test('a command that settles as an error with attachments is a refusal; a dropped receipt goes to attachmentRefused', async () => {
  const noFiles = rig({ answers: { 'commands/execute': { result: { kind: 'error', text: '/compact does not accept attachments' } } } });
  const why = [];
  assert.equal(await noFiles.actions.send('/compact', { sessionId: 's1', attachments: [filePart], attachmentRefused: x => why.push(x) }), null);
  assert.equal(sayOf(noFiles.store.get().status.line), '/compact does not accept attachments');
  assert.equal(noFiles.store.get().status.bad, true);
  assert.deepEqual(why, []);
  const dropped = rig({ answers: { 'commands/execute': { result: { kind: 'error', text: 'File upload receipt is unknown for this session.' } } } });
  assert.equal(await dropped.actions.send('/goal x', { sessionId: 's1', attachments: [filePart], attachmentRefused: x => why.push(x) }), null);
  assert.deepEqual(why, ['ATTACHMENT_NOT_FOUND']);
  const plain = rig({ answers: { 'commands/execute': { result: { kind: 'error', text: 'no goal' } } } });
  assert.deepEqual(await plain.actions.send('/goal resume', { sessionId: 's1', sessionId: 's1' }), { sent: 'command', sessionId: 's1' }, 'with no files an error result is still the command\'s answer');
});

test('the actions create no session: the conversation is the one entry, a bot is talked to through Gravit', () => {
  assert.deepEqual(Object.keys(rig().actions).sort(), ['answer', 'command', 'runCommand', 'send', 'stop', 'stopChild']);
});
