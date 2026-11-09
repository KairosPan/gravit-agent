// Session rows become conversations (spec 2026-10-19 §5, §7 "List"): title, kind, members, channel, liveness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, conversationOf, listConversations, unreadOf, childRowsOf } from '../../client/js/host/sessions.js';

const ctx = (over = {}) => ({ presets: {}, bots: new Map([['buffett', { name: 'Buffett' }]]), channelOf: () => null, rooms: new Map(), lastSeen: {}, archived: new Set(), hostArchived: new Set(), deleted: new Set(), ...over });
const row = (id, over = {}) => ({ sessionId: id, updatedAt: 5, agentAvailable: false, running: false, blank: false, ...over });
const titled = (id, title, preset, over = {}) => row(id, { projections: { values: { title, ...(preset ? { agentPreset: preset } : {}) } }, ...over });

test('a bare row is an Untitled Gravit conversation that is not live', () => {
  const c = conversationOf(row('s1'), ctx());
  assert.equal(c.id, 's1'); assert.equal(c.title, 'Untitled'); assert.equal(c.kind, 'gravit');
  assert.deepEqual(c.members, ['gravit']); assert.equal(c.live, false); assert.equal(c.running, false);
  assert.equal(c.updatedAt, 5); assert.equal(c.channel, null); assert.equal(c.preset, undefined);
  assert.deepEqual(c.messages, []); assert.equal(c.loaded, false); assert.equal(c.preview, null); assert.equal(c.usage, null); assert.equal(c.thinking, null);
  assert.equal(c.lastSeen, 0); assert.equal(c.archived, false);
});

test("a bot's home session is kind bot, titled by its projection, with the bot as its one member", () => {
  const c = conversationOf(titled('s2', 'BTC', 'buffett', { agentAvailable: true, running: true }), ctx());
  assert.equal(c.kind, 'bot'); assert.equal(c.title, 'BTC'); assert.deepEqual(c.members, ['buffett']);
  assert.equal(c.preset, 'buffett'); assert.equal(c.live, true); assert.equal(c.running, true);
});

test('a session whose room projection reads room is a group with the projected members after Gravit', () => {
  const rooms = new Map([['s1', { kind: 'room', round: 1, members: { buffett: { state: 'idle' } }, organizing: false }]]);
  const c = conversationOf(titled('s1', 'Pick stocks', 'gravit'), ctx({ rooms }));
  assert.equal(c.kind, 'group'); assert.deepEqual(c.members, ['gravit', 'buffett']);
  assert.equal(kindOf(titled('s1', 'x', 'gravit'), rooms.get('s1'), []), 'group');
});

test('kindOf: host preset → gravit, a bot preset → bot, members from the fold → group', () => {
  assert.equal(kindOf(titled('a', 'x', 'gravit'), undefined, []), 'gravit');
  assert.equal(kindOf(titled('a', 'x', 'kairos'), undefined, []), 'gravit');
  assert.equal(kindOf(titled('a', 'x', 'buffett'), undefined, []), 'bot');
  assert.equal(kindOf(titled('a', 'x', 'gravit'), undefined, ['buffett']), 'group');
});

test('archived conversations stay, marked host or face; deleted ones, children and members leave; newest first', () => {
  const items = [
    titled('old', 'Old', 'gravit', { updatedAt: 1 }),
    titled('room', 'Room', 'gravit', { updatedAt: 3 }),
    titled('m1', 'member', 'buffett', { updatedAt: 9, parentSessionId: 'room' }),
    titled('child', 'child', 'gravit', { updatedAt: 8, origin: 'subagent' }),
    titled('gone', 'gone', 'gravit', { updatedAt: 7 }),
    titled('dead', 'dead', 'gravit', { updatedAt: 6 }),
    titled('new', 'New', 'gravit', { updatedAt: 4 }),
  ];
  const list = listConversations(items, ctx({ archived: new Set(['gone', 'old']), hostArchived: new Set(['old']), deleted: new Set(['dead']) }));
  assert.deepEqual(list.map(c => c.id), ['gone', 'new', 'room', 'old']);
  assert.equal(list.find(c => c.id === 'gone').archived, 'face');
  assert.equal(list.find(c => c.id === 'old').archived, 'host', 'the host archive wins over the face one');
  assert.equal(list.find(c => c.id === 'new').archived, false);
  const room = list.find(c => c.id === 'room');
  assert.equal(room.kind, 'group', 'the fold alone makes a room');
  assert.deepEqual(room.members, ['gravit', 'buffett']);
  assert.deepEqual(room.memberSessions, ['m1']);
});

test('the list restores a preset from the face\'s hints when the row carries none', () => {
  const list = listConversations([row('s9')], ctx({ presets: { s9: 'buffett' } }));
  assert.equal(list[0].kind, 'bot'); assert.equal(list[0].preset, 'buffett');
});

test('a conversation carries its channel and its last-seen seq', () => {
  const c = conversationOf(row('s1', { cwd: '/x/strategies/alpha' }), ctx({ channelOf: id => (id === 's1' ? { workspaceId: 'w1', name: 'alpha' } : null), lastSeen: { s1: 12 } }));
  assert.deepEqual(c.channel, { workspaceId: 'w1', name: 'alpha' }); assert.equal(c.lastSeen, 12);
});

test('unread means the host moved it after the operator last looked', () => {
  assert.equal(unreadOf({ updatedAt: 10, lastSeen: 5 }), true);
  assert.equal(unreadOf({ updatedAt: 10, lastSeen: 10 }), false);
  assert.equal(unreadOf({ updatedAt: 10, lastSeen: 0 }), true);
});

test('childRowsOf keeps the subagent rows with their parent and whether they run', () => {
  const items = [row('p'), row('c1', { origin: 'subagent', parentSessionId: 'p', running: true }), row('c2', { origin: 'subagent', parentSessionId: 'c1' }), row('m', { parentSessionId: 'p', agentPreset: 'buffett' }), null];
  assert.deepEqual(childRowsOf(items), [
    { sessionId: 'c1', parentSessionId: 'p', running: true, origin: 'subagent' },
    { sessionId: 'c2', parentSessionId: 'c1', running: false, origin: 'subagent' },
  ]);
  assert.deepEqual(childRowsOf(undefined), []);
});

