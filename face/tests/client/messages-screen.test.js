// The Messages screen on the host's facts (spec 2026-10-19 §7): the head, the composer, the status line, the new-message
// screen with its Where, the Details drawer with This task, Members, Usage, Stop and Change words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentConversation, renderMessagesScreen, renderHead, renderComposer, renderDetails, renderStatus } from '../../client/js/render/messages.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const count = (h, re) => (h.match(re) ?? []).length;
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const channels = [{ workspaceId: 'w0', name: 'workbench', isRoot: true }, { workspaceId: 'w1', name: 'alpha', isRoot: false }];
const bots = [{ id: 'buffett', name: 'Buffett Type' }];
const listed = (convs, open = convs[0]?.id ?? null) => R.nav(R.hostList(emptyState(), { conversations: convs, channels, bots }), { screen: 'messages', id: open });

test('currentConversation falls back to the first when the route names nothing or a missing id', () => {
  const s = listed([conv('a'), conv('b')], 'b');
  assert.equal(currentConversation(s).id, 'b');
  assert.equal(currentConversation({ ...s, route: { screen: 'messages', id: 'zz' } }).id, 'a');
  assert.equal(currentConversation({ ...s, conversations: [] }), null);
});

test('the head is the title, a Working chip only while the host runs a turn, and Details', () => {
  const s = listed([conv('a', { title: 'BTC under 70k' })]);
  const quiet = renderHead(currentConversation(s), s);
  assert.match(quiet, /<h1 class="head-title">BTC under 70k<\/h1>/);
  assert.doesNotMatch(quiet, /status up/);
  assert.match(quiet, /data-action="toggleDetails"[^>]*aria-expanded="false"/);
  const busy = renderHead({ ...currentConversation(s), running: true }, { ...s, detailsOpen: true });
  assert.match(busy, /class="status up"><span class="status-dot"><\/span>Working</);
  assert.match(busy, /aria-expanded="true"/);
});

test('a group head clusters the members and names them from the host\'s bots', () => {
  const s = listed([conv('g', { kind: 'group', members: ['gravit', 'buffett'], title: 'Pick stocks' })]);
  const h = renderHead(currentConversation(s), s);
  assert.match(h, /head centered/); assert.equal(count(h, /class="cluster-item"/g), 2);
  assert.match(h, /Gravit · Buffett Type · 2 members/);
});

test('the composer is the box and Send: no files, no mic', () => {
  const h = renderComposer();
  assert.match(h, /<form class="composer" data-action="send">/);
  assert.match(h, /<input id="say" class="composer-input"[^>]*placeholder="Tell Gravit…"/);
  assert.match(h, /class="send-key" aria-label="Send"/);
  for (const gone of ['attachFiles', 'toggleMic', 'pickFile', 'attach-input']) assert.doesNotMatch(h, new RegExp(gone));
  assert.match(renderComposer({ placeholder: 'Tell Gravit… @ a bot by name' }), /@ a bot by name/);
});

test('the status line under the composer carries the host\'s word, marked bad when it is', () => {
  assert.equal(renderStatus({ line: '', bad: false, connected: true }), '');
  assert.equal(renderStatus({ line: 'Reconnecting…', bad: true, connected: false }), '<div class="status-line bad" role="status">Reconnecting…</div>');
  const s = R.hostStatus(listed([conv('a')]), { line: 'sent', bad: false });
  assert.match(renderMessagesScreen(s, NOW), /class="status-line" role="status">sent</);
});

test('the new-message screen: a title, Where among the channels with the root first, no To: row, no limit chips', () => {
  const s = R.startDraft(listed([conv('a')]), { now: NOW });
  assert.equal(s.draft.where, 'w0', 'the root channel is the default');
  const h = renderMessagesScreen(s, NOW);
  assert.match(h, /<input id="nm-title" class="title-input"[^>]*data-action="draftTitle"/);
  assert.match(h, /<select id="nm-where" name="where"[^>]*data-action="draftWhere">/);
  assert.match(h, /<option value="w0" selected>workbench<\/option><option value="w1">alpha<\/option>/);
  assert.match(h, /data-action="cancelDraft"/);
  for (const gone of ['To:', 'Attach a limit', 'toggleDraftPicker', 'draftLimit']) assert.doesNotMatch(h, new RegExp(gone));
  const moved = R.setDraftWhere(s, 'w1');
  assert.match(renderMessagesScreen(moved, NOW), /<option value="w1" selected>/);
});

test('Details: This task with its facts and Change words, Members for a group, Usage when the host reported it, Stop only while running', () => {
  const quiet = listed([conv('a', { title: 'BTC under 70k', created: NOW - 3 * 24 * 60 * MIN, channel: { workspaceId: 'w1', name: 'alpha' } })]);
  const h = renderDetails(currentConversation(quiet), quiet);
  assert.match(h, /dsec-title">BTC under 70k</);
  assert.match(h, /data-action="changeWords"/);
  assert.match(h, />Where<[\s\S]*?>alpha</); assert.match(h, />Agent<[\s\S]*?>Gravit</);
  assert.match(h, />Created</);
  for (const gone of ['Limit', 'wallet', 'Mode', 'withdraw', 'Beast', 'stopGravit', 'Usage', 'Members']) assert.doesNotMatch(h, new RegExp(gone), gone);
  const busy = listed([conv('b', { running: true, kind: 'group', members: ['gravit', 'buffett'], usage: { tokenUsage: { uncachedInputTokens: 8123, outputTokens: 2411, cacheReadTokens: 51200, cacheWriteTokens: 900 }, contextPressure: 0.42 } })]);
  const d = renderDetails(currentConversation(busy), busy);
  assert.match(d, /data-action="stopGravit"[^>]*data-conv="b"/);
  assert.match(d, />Members<[\s\S]*?Buffett Type/);
  assert.match(d, />Tokens in<[\s\S]*?>59,323</); assert.match(d, />Tokens out<[\s\S]*?>2,411</); assert.match(d, />Context<[\s\S]*?>42%</);
  assert.match(renderDetails(currentConversation(listed([conv('c', { channel: null, created: null })])), quiet), />Where<[\s\S]*?>Default directory</);
  const asking = R.askConfirm(busy, { action: 'stopGravit', id: 'b' });
  assert.match(renderDetails(currentConversation(asking), asking), /data-action="confirmYes"/);
});

test('the empty state offers three plain prompts', () => {
  const h = renderMessagesScreen(listed([]), NOW);
  assert.equal(count(h, /data-action="suggest"/g), 3);
  assert.match(h, /Nothing handed to Gravit yet/);
});

test('Details offers Fork, Archive and Delete on an idle conversation', () => {
  const s = listed([conv('a', { archived: false })]);
  const h = renderDetails(currentConversation(s), s);
  assert.match(h, /data-action="fork"[^>]*data-conv="a"/);
  assert.match(h, /data-action="archive"[^>]*data-conv="a"/);
  assert.match(h, /data-action="deleteConv"[^>]*data-conv="a"/);
  assert.doesNotMatch(h, /data-action="unarchive"/);
  const asking = R.askConfirm(s, { action: 'deleteConv', id: 'a' });
  assert.match(renderDetails(currentConversation(asking), asking), /data-action="confirmYes"[^>]*>Yes, delete</);
});

test('no Archive or Delete while running or while a card waits', () => {
  const card = { id: 'ev-1', seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 'a' } };
  for (const over of [{ running: true }, { messages: [card] }]) {
    const s = listed([conv('a', { archived: false, ...over })]);
    const h = renderDetails(currentConversation(s), s);
    assert.match(h, /data-action="fork"/);
    assert.doesNotMatch(h, /data-action="archive"/);
    assert.doesNotMatch(h, /data-action="deleteConv"/);
  }
});

test('a face archive offers Un-archive; a host archive says so and offers nothing', () => {
  const face = listed([conv('a', { archived: 'face' })]);
  const f = renderDetails(currentConversation(face), face);
  assert.match(f, /data-action="unarchive"[^>]*data-conv="a"/);
  assert.doesNotMatch(f, /data-action="archive"/);
  const host = listed([conv('a', { archived: 'host' })]);
  const h = renderDetails(currentConversation(host), host);
  assert.match(h, />Archived<[\s\S]*?>By the host</);
  assert.doesNotMatch(h, /data-action="unarchive"|data-action="archive"/);
});
