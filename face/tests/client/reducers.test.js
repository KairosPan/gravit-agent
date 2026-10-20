// gravit-ui/tests/reducers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { seed } from './helpers/seed.js';
import { MIN } from '../../client/js/time.js';
import { emptyState } from '../../client/js/data/empty.js';

const NOW = new Date(2026, 9, 9, 14, 7).getTime();
const fresh = () => seed(NOW);
const conv = (s, id) => s.conversations.find(c => c.id === id);

test('nav opens a conversation, clears its unread dot, closes drawers and drops a draft', () => {
  let s = R.startDraft(fresh(), { now: NOW });
  assert.ok(s.draft);
  s = R.nav(s, { screen: 'messages', id: 'c-2' });
  assert.equal(s.draft, null);
  assert.equal(s.detailsOpen, false);
  const same = R.nav(s, { screen: 'discover' });
  assert.equal(same.route.screen, 'discover');
});


test('account: memory add/edit/forget/forget all, switches, settings; no mode', () => {
  let s = fresh();
  assert.equal(R.setMode, undefined, 'Guard | Beast is gone');
  assert.equal(R.addMemory(s, { text: '  ', now: NOW }), s);
  s = R.addMemory(s, { text: 'No new positions on Fridays', now: NOW });
  const added = s.memory.entries.at(-1);
  assert.equal(added.id, 'mem-10');
  assert.equal(added.source, 'You said');
  s = R.editMemory(s, { id: 'mem-10', text: 'No new positions on Fridays, nor Mondays' });
  assert.equal(s.memory.entries.at(-1).text, 'No new positions on Fridays, nor Mondays');
  s = R.forgetMemory(s, 'mem-1');
  assert.equal(s.memory.entries.length, 9);
  s = R.setMemorySwitch(s, { key: 'askFirst', value: true });
  assert.equal(s.memory.askFirst, true);
  s = R.forgetAll(s);
  assert.deepEqual(s.memory.entries, []);
  s = R.openSettings(s);
  assert.equal(s.settingsOpen, true);
  assert.equal(R.closeSettings(s).settingsOpen, false);
});

test('nav normalises a missing or empty conversation id to the first; new without a draft too', () => {
  assert.equal(R.nav(fresh(), { screen: 'messages', id: 'c-99' }).route.id, 'c-1');
  assert.equal(R.nav(fresh(), { screen: 'messages', id: null }).route.id, 'c-1');
  assert.equal(R.nav(fresh(), { screen: 'messages', id: 'new' }).route.id, 'c-1');
  const drafting = R.startDraft(fresh(), { now: NOW });
  assert.equal(R.nav(drafting, { screen: 'messages', id: 'new' }).route.id, 'new');
  const empty = { ...fresh(), conversations: [] };
  assert.equal(R.nav(empty, { screen: 'messages', id: 'c-1' }).route.id, null);
});


// final review fixes




const hostConv = (id, over = {}) => ({ id, title: id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, archived: false, updatedAt: 1, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });

test('nav to a missing id and Cancel open the first open conversation, never an archived one', () => {
  const s = { ...emptyState(), conversations: [hostConv('old', { archived: 'face' }), hostConv('a')] };
  assert.equal(R.nav(s, { screen: 'messages', id: 'gone' }).route.id, 'a');
  assert.equal(R.nav(s, { screen: 'messages', id: null }).route.id, 'a');
  assert.equal(R.nav(s, { screen: 'messages', id: 'old' }).route.id, 'old', 'an archived conversation opens by its id');
  assert.equal(R.cancelDraft(R.startDraft(s, { now: NOW })).route.id, 'a');
  const allArchived = { ...s, conversations: [hostConv('old', { archived: 'host' })] };
  assert.equal(R.nav(allArchived, { screen: 'messages', id: null }).route.id, null);
});
