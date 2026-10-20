// The reducers on host-shaped states (spec 2026-10-19 §5): routes, the draft, the defaults that skip archived
// conversations, and the empty state's slices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { parseHash } from '../../client/js/router.js';

const NOW = new Date(2026, 9, 9, 14, 7).getTime();
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

test('nav opens a conversation, closes drawers and drops a draft', () => {
  const s = { ...emptyState(), conversations: [hostConv('a'), hostConv('b')] };
  let t = R.startDraft(R.toggleDetails(R.nav(s, { screen: 'messages', id: 'a' })), { now: NOW });
  assert.ok(t.draft);
  t = R.nav(t, { screen: 'messages', id: 'b' });
  assert.equal(t.draft, null); assert.equal(t.detailsOpen, false); assert.equal(t.route.id, 'b');
  assert.equal(R.nav(t, { screen: 'discover', id: null }).route.screen, 'discover');
  assert.equal(R.nav(s, { screen: 'messages', id: 'new' }).route.id, 'a', 'new without a draft opens the first');
});

test('nav folds #/mail to Messages', () => {
  const s = { ...emptyState(), conversations: [hostConv('a')] };
  assert.deepEqual(parseHash('#/mail/x'), { screen: 'messages', id: null });
  assert.deepEqual(R.nav(s, parseHash('#/mail')).route, { screen: 'messages', id: 'a' });
});

test('the empty state carries no demo slice', () => {
  const s = emptyState();
  for (const gone of ['plugins', 'memory', 'mail', 'banner', 'call', 'compose']) assert.equal(gone in s, false, gone);
  for (const gone of ['addMemory', 'editMemory', 'forgetMemory', 'forgetAll', 'setMemorySwitch', 'append']) assert.equal(R[gone], undefined, gone);
});
