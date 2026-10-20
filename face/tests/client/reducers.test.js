// gravit-ui/tests/reducers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { seed } from './helpers/seed.js';
import { MIN } from '../../client/js/time.js';
import { REVIEW_MS } from '../../client/js/reducers/discover.js';

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

test('discover: install adds the plugin, a teaching conversation and a toast; uninstall removes', () => {
  const s0 = R.nav(fresh(), { screen: 'plugin', id: 'news' });
  assert.deepEqual(s0.route, { screen: 'plugin', id: 'news' });
  assert.deepEqual(R.nav(fresh(), { screen: 'plugin', id: 'nope' }).route, { screen: 'discover', id: null }, 'a plugin that is not there opens Discover');
  const s1 = R.install(s0, { id: 'news', now: NOW });
  assert.ok(s1.plugins.installed.includes('news'));
  assert.match(s1.discover.toast.text, /News sentiment installed/);
  assert.equal(s1.conversations[0].title, 'News sentiment: how to use me');
  assert.equal(s1.conversations[0].unread, true);
  assert.equal(s1.conversations[0].members[1], 'news');
  assert.equal(s1.discover.toast.action.route.id, s1.conversations[0].id);
  assert.equal(R.install(s1, { id: 'news', now: NOW }), s1, 'installing twice is a no-op');
  const s2 = R.uninstall(s1, 'news');
  assert.ok(!s2.plugins.installed.includes('news'));
  assert.equal(s2.conversations[0].title, 'News sentiment: how to use me', 'the conversation stays');
  const s3 = s2;
  const s4 = R.setQuery(R.toggleInstalledOnly(s3), 'bot');
  assert.equal(s4.discover.installedOnly, true);
  assert.equal(s4.discover.query, 'bot');
  assert.equal(R.dismissToast(s4).discover.toast, null);
});

test('account: mode, memory add/edit/forget/forget all, switches, settings', () => {
  let s = R.setMode(fresh(), 'beast');
  assert.equal(s.account.mode, 'beast');
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

// the scripted client against Discover's MCP face: start, connect, ask to publish
const atSign = (s, manifest) => { const r = s.discover.create.run; return R.clientPublishes(R.clientConnected(R.startClient(s, { run: r }), { run: r }), { run: r, manifest }); };

// final review fixes

test('installing answers every waiting ask for that plugin and tells the conversation', () => {
  const s = R.install(fresh(), { id: 'news', now: NOW });
  const c1 = conv(s, 'c-1');
  assert.equal(c1.messages.find(m => m.kind === 'install' && m.data.plugin === 'news').answer, 'installed');
  assert.equal(c1.messages.at(-1).from, 'gravit');
  assert.match(c1.messages.at(-1).text, /News sentiment installed/);
});

test('leaving Discover and its plugin pages clears its dialog and toast; moving between them keeps the toast', () => {
  const s = R.install(R.nav(fresh(), { screen: 'discover', id: null }), { id: 'news', now: NOW });
  const away = R.nav(R.openCreate(s), { screen: 'messages', id: 'c-1' });
  assert.deepEqual([away.discover.create, away.discover.toast], [null, null]);
  const page = R.nav(s, { screen: 'plugin', id: 'news' });
  assert.ok(page.discover.toast, 'the toast follows you onto the plugin page');
  assert.ok(R.nav(page, { screen: 'discover', id: 'bots' }).discover.toast, 'and back');
  assert.deepEqual(R.nav(R.nav(fresh(), { screen: 'discover', id: 'bots' }), { screen: 'messages', id: 'c-1' }).lastDiscover, { screen: 'discover', id: 'bots' });
});

test('an install conversation knows which plugin it teaches', () => {
  const s0 = fresh();
  assert.equal(R.install(s0, { id: 'no-such-plugin', now: NOW }), s0);
  const t = R.install(R.uninstall(fresh(), 'buffett'), { id: 'buffett', now: NOW });
  assert.equal(t.conversations[0].teach, 'buffett');
});
