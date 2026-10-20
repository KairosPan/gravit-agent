// The two-level rail on the host's facts (spec 2026-10-19 §7 "Rail", "List"): Messages with its badge, Markets and Account
// as links to the old pages, no Discover, Trade, phone or mail in stage 1; rows from the conversations the list gave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatar, cluster, groupMark } from '../../client/js/render/avatars.js';
import { renderRail, renderNav, renderList, previewOf, senderName } from '../../client/js/render/rail.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const count = (h, re) => (h.match(re) ?? []).length;
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const gate = { id: 'ev-1', seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 'a' } };
const bots = [{ id: 'buffett', name: 'Buffett Type' }];
const listed = (convs, open = convs[0]?.id ?? null, extra = {}) => {
  let s = R.hostList(emptyState(), { conversations: convs, channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true }], bots });
  s = { ...s, ...extra };
  return R.nav(s, { screen: 'messages', id: open });
};

test('the first level: Messages, then Markets and Account as links to the old pages; no Discover, Trade, phone or mail', () => {
  const h = renderNav(listed([conv('a')]));
  assert.match(h, /href="#\/messages\/a"[^>]*>[\s\S]*?Messages/);
  assert.match(h, /href="\/market"[^>]*>[\s\S]*?Markets/);
  assert.match(h, /href="\/account"[^>]*class="account/);
  assert.match(h, /account-title">Account</);
  assert.match(h, /data-action="openSettings"/, 'the theme lives behind a Settings key at the foot');
  for (const gone of ['#/discover', '#/trade', 'phoneCall', '#/mail', 'nav-badge', 'Guard']) assert.doesNotMatch(h, new RegExp(gone), gone);
});

test('the Messages badge counts the conversations holding an unanswered gate', () => {
  let s = listed([conv('a'), conv('b'), conv('c')], 'a');
  s = R.hostGate(s, { convId: 'b', message: gate });
  s = R.hostGate(s, { convId: 'c', message: { ...gate, id: 'ev-2', data: { eventId: 'ev-2', sessionId: 'c' } } });
  s = R.hostGate(s, { convId: 'c', message: { ...gate, id: 'ev-3', data: { eventId: 'ev-3', sessionId: 'c' } } });
  assert.match(renderNav(s), /nav-badge">2</);
  const settled = R.hostGateGone(R.hostGateGone(R.hostGateGone(s, { eventId: 'ev-1', outcome: 'closed' }), { eventId: 'ev-2', outcome: 'approved' }), { eventId: 'ev-3', outcome: 'closed' });
  assert.doesNotMatch(renderNav(settled), /nav-badge/);
});

test('collapsed, the first level is a strip of icons with the names as titles', () => {
  const h = renderNav(listed([conv('a')], 'a', { railCollapsed: true }));
  assert.match(h, /class="rail mini"/);
  assert.match(h, /title="Markets"/);
  assert.match(h, /aria-label="Expand navigation"/);
});

test('a row: the title, the time of the last activity, the preview, the unread dot, and the current mark', () => {
  const s = listed([conv('a', { title: 'BTC under 70k', preview: 'Got it.', updatedAt: NOW - 3 * MIN }), conv('b', { title: 'Untitled', lastSeen: NOW })], 'a');
  const h = renderList(s, NOW);
  assert.match(h, /row current[^>]*aria-current="page"[^>]*href="#\/messages\/a"/);
  assert.match(h, /row-title">BTC under 70k</);
  assert.match(h, /row-preview">Got it.</);
  assert.match(h, /row-time">14:04</);
  assert.equal(count(h, /class="dot on"/g), 0, 'opening a row reads it; the other was seen after its last activity');
  const unread = R.hostList(s, { conversations: [conv('a', { preview: 'x' }), conv('b', { updatedAt: NOW + MIN })] });
  assert.equal(count(renderList(unread, NOW), /class="dot on"/g), 1, 'b moved after the operator last looked');
});

test("a row's preview falls back to the last message's words, and a row with nothing says nothing", () => {
  const s = listed([conv('a', { messages: [{ id: 'e1', seq: 1, at: NOW, from: 'gravit', kind: 'text', text: 'Both pivots hold.', data: {} }] }), conv('b')]);
  const h = renderList(s, NOW);
  assert.match(h, /row-preview">Both pivots hold.</);
  assert.equal(previewOf(conv('b')), '');
  assert.equal(previewOf(conv('g', { kind: 'group', messages: [{ id: 'e1', seq: 1, at: NOW, from: 'buffett', kind: 'text', text: '买。', data: { name: '巴菲特型' } }] }), s), '巴菲特型: 买。');
});

test('the row mark follows the kind: G, the bot\'s letter from the host\'s bots, a two-circle mark for a group', () => {
  const s = listed([conv('a'), conv('b', { kind: 'bot', preset: 'buffett', members: ['buffett'] }), conv('c', { kind: 'group', members: ['gravit', 'buffett'] })], 'a');
  const h = renderList(s, NOW);
  assert.equal(count(h, /class="av av-g"/g), 2, 'G on the Gravit row and inside the group mark');
  assert.match(h, /av-letter tone-grey[^>]*>B</);
  assert.equal(count(h, /class="group-mark"/g), 1);
  assert.equal(senderName('buffett', s), 'Buffett Type');
  assert.equal(senderName('ghost', s), 'ghost');
  assert.match(avatar('buffett', 28, s), />B</);
  assert.equal(count(cluster(['gravit', 'buffett'], 44, s), /class="cluster-item"/g), 2);
  assert.equal(count(groupMark(['gravit', 'buffett'], 36, s), /class="av /g), 2);
});

test('a draft puts a New message row on top; the list is only on Messages', () => {
  const s = R.startDraft(listed([conv('a')]), { now: NOW });
  const h = renderList(s, NOW);
  assert.match(h, /row current draft[^>]*href="#\/messages\/new"/);
  assert.ok(h.indexOf('New message') < h.indexOf('T a'));
  assert.equal(renderList({ ...s, route: { screen: 'account', tab: 'portfolio' } }, NOW), '');
  assert.match(renderRail(s, NOW), /class="rail"[\s\S]*class="list"/);
});
