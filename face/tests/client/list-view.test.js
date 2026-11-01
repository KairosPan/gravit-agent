// The list's groups (spec 2026-10-19 §7 Stage 3 "Channels"): one per channel, a bot's home sessions under the bot,
// No channel, Archived last and collapsed; the order the plan's calls fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsOf } from '../../client/js/host/list-view.js';
import { emptyState } from '../../client/js/data/empty.js';

const conv = (id, over = {}) => ({ id, title: id, kind: 'gravit', members: ['gravit'], channel: null, preset: 'gravit', archived: false, updatedAt: 1, messages: [], ...over });
const ch = (workspaceId, name, over = {}) => ({ workspaceId, name, title: name, dir: `/r/strategies/${name}`, isRoot: false, missingDir: false, sessionIds: [], ...over });
const state = (conversations, extra = {}) => ({
  ...emptyState(), conversations, route: { screen: 'messages', id: null },
  channels: [ch('w0', 'workbench', { isRoot: true, dir: '/r' }), ch('w1', 'alpha'), ch('w2', 'beta'), ch('w3', 'zeta')],
  bots: [{ id: 'buffett', name: 'Buffett Type' }], ...extra,
});
const keys = gs => gs.map(g => g.key);

test('every channel is a group, an empty one included, the root first, then by the newest conversation', () => {
  const gs = groupsOf(state([conv('a', { channel: { workspaceId: 'w2', name: 'beta' }, updatedAt: 9 }), conv('b', { channel: { workspaceId: 'w1', name: 'alpha' }, updatedAt: 5 })]));
  assert.deepEqual(keys(gs), ['w0', 'w2', 'w1', 'w3']);
  assert.deepEqual(gs.map(g => g.label), ['workbench', 'beta', 'alpha', 'zeta']);
  assert.deepEqual(gs[1].conversations.map(c => c.id), ['a']);
  assert.equal(gs[0].kind, 'channel'); assert.equal(gs[0].workspaceId, 'w0');
  assert.deepEqual(gs[3].conversations, []);
});

test("a bot's home sessions group under the bot; sessions in no channel under No channel; Archived last and collapsed by default", () => {
  const gs = groupsOf(state([
    conv('x', { archived: 'face', channel: { workspaceId: 'w1', name: 'alpha' }, updatedAt: 99 }),
    conv('h', { kind: 'bot', preset: 'buffett', members: ['buffett'], updatedAt: 8 }),
    conv('n', { updatedAt: 7 }),
  ]));
  assert.deepEqual(keys(gs), ['w0', 'bot:buffett', '__ungrouped', 'w1', 'w2', 'w3', '__archived']);
  const by = k => gs.find(g => g.key === k);
  assert.equal(by('bot:buffett').label, 'Buffett Type'); assert.equal(by('bot:buffett').kind, 'bot'); assert.equal(by('bot:buffett').workspaceId, null);
  assert.equal(by('__ungrouped').label, 'No channel'); assert.equal(by('__ungrouped').kind, 'none');
  assert.equal(by('__archived').label, 'Archived'); assert.equal(by('__archived').kind, 'archived');
  assert.equal(by('__archived').collapsed, true); assert.equal(by('w0').collapsed, false);
  assert.deepEqual(by('__archived').conversations.map(c => c.id), ['x']);
  const flipped = groupsOf(state([conv('x', { archived: 'host' })], { collapsed: { __archived: false, w0: true } }));
  assert.equal(flipped.find(g => g.key === '__archived').collapsed, false);
  assert.equal(flipped.find(g => g.key === 'w0').collapsed, true);
});

test('a collapsed group keeps the conversation on screen', () => {
  const convs = [conv('a', { channel: { workspaceId: 'w1', name: 'alpha' }, updatedAt: 3 }), conv('b', { channel: { workspaceId: 'w1', name: 'alpha' }, updatedAt: 2 })];
  const open = groupsOf(state(convs, { collapsed: { w1: true }, route: { screen: 'messages', id: 'b' } }));
  assert.deepEqual(open.find(g => g.key === 'w1').shown.map(c => c.id), ['b']);
  const shut = groupsOf(state(convs, { collapsed: { w1: true }, route: { screen: 'markets', id: null } }));
  assert.deepEqual(shut.find(g => g.key === 'w1').shown, []);
  assert.deepEqual(groupsOf(state(convs)).find(g => g.key === 'w1').shown.map(c => c.id), ['a', 'b']);
});
