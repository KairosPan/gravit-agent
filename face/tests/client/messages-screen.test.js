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
  const said = { id: 'e1', seq: 1, at: NOW, from: 'you', kind: 'text', text: 'hi', data: {} };
  const s = listed([conv('a', { archived: false, loaded: true, messages: [said] })]);
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
  const said = { id: 'e1', seq: 1, at: NOW, from: 'you', kind: 'text', text: 'hi', data: {} };
  for (const over of [{ running: true, messages: [said] }, { messages: [said, card] }]) {
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

test('Where offers New channel…; the edit asks for the name', () => {
  const s = R.startDraft(listed([conv('a')]), {});
  const h = renderMessagesScreen(s, NOW);
  assert.match(h, /<option value="__new">New channel…<\/option>/);
  const naming = R.startEdit(s, { kind: 'newChannel' });
  const n = renderMessagesScreen(naming, NOW);
  assert.match(n, /class="inline-edit"/);
  assert.match(n, /name="channel"[^>]*aria-label="Name the channel"|aria-label="Name the channel"[^>]*name="channel"/);
  assert.match(renderMessagesScreen(R.editFailed(naming, { error: 'Letters, digits, - or _' }), NOW), /Letters, digits, - or _/);
});

test('Details lists the children with Stop on the one that can', () => {
  const s = R.hostList(listed([conv('a', { live: true, subagentCatalog: [{ id: 'live', createdAt: 1, mode: 'continuable', label: 'Check' }, { id: 'once', createdAt: 2, mode: 'one-shot' }] })]),
    { conversations: [conv('a', { live: true })], childRows: [{ sessionId: 'live', parentSessionId: 'a', running: true, origin: 'subagent' }, { sessionId: 'once', parentSessionId: 'a', running: false, origin: 'subagent' }] });
  const h = renderDetails(currentConversation(s), s);
  assert.match(h, />Children</);
  assert.match(h, /Check[\s\S]*?Continuable · Running/);
  assert.match(h, /Subagent[\s\S]*?One-shot · Not running/);
  assert.match(h, /data-action="stopChild" data-parent="a" data-child="live" data-label="Check"/);
  assert.equal((h.match(/data-action="stopChild"/g) ?? []).length, 1, 'a one-shot child has no Stop');
  const asking = R.askConfirm(s, { action: 'stopChild', id: 'live', parent: 'a', label: 'Check' });
  assert.match(renderDetails(currentConversation(asking), asking), /data-action="confirmYes"[^>]*>Yes, stop</);
  const broken = R.hostProjection(s, { convId: 'a', key: 'subagentCatalog', value: { bad: true } });
  assert.match(renderDetails(currentConversation(broken), broken), /Children unavailable/);
  assert.doesNotMatch(renderDetails(currentConversation(listed([conv('b')])), listed([conv('b')])), />Children</);
});

test('an empty conversation offers no Fork: dsh forks from a completed turn', () => {
  const s = listed([conv('a', { archived: false, loaded: true, messages: [] })]);
  const h = renderDetails(currentConversation(s), s);
  assert.doesNotMatch(h, /data-action="fork"/);
  assert.match(h, /data-action="archive"/); assert.match(h, /data-action="deleteConv"/);
});

test('a channel goes by its display title in Where and in Details, as the list names it', () => {
  const titled = [{ workspaceId: 'w0', name: 'workbench', title: 'evolving-alpha-us', isRoot: true }, { workspaceId: 'w1', name: 'alpha', title: 'Alpha momentum', isRoot: false }];
  const base = R.nav(R.hostList(emptyState(), { conversations: [conv('a', { channel: { workspaceId: 'w1', name: 'alpha' } })], channels: titled, bots }), { screen: 'messages', id: 'a' });
  const draft = renderMessagesScreen(R.startDraft(base, {}), NOW);
  assert.match(draft, /<option value="w0" selected>evolving-alpha-us<\/option><option value="w1">Alpha momentum<\/option>/);
  assert.match(renderDetails(currentConversation(base), base), />Where<[\s\S]*?>Alpha momentum</);
});

test('Details offers Pin between Fork and Archive, Unpin once pinned, nothing when archived', () => {
  const said = { id: 'e1', seq: 1, at: NOW, from: 'you', kind: 'text', text: 'hi', data: {} };
  const mk = (over, extra = {}) => { const s = { ...listed([conv('a', { archived: false, loaded: true, messages: [said], ...over })]), ...extra }; return renderDetails(currentConversation(s), s); };
  const h = mk({});
  assert.match(h, /data-action="fork"[\s\S]*data-action="pin"[^>]*data-conv="a"[^>]*>Pin<[\s\S]*data-action="archive"/);
  assert.doesNotMatch(h, /data-action="unpin"/);
  const p = mk({}, { pinned: ['a'] });
  assert.match(p, /data-action="fork"[\s\S]*data-action="unpin"[^>]*data-conv="a"[^>]*>Unpin<[\s\S]*data-action="archive"/);
  assert.doesNotMatch(p, /data-action="pin"/);
  const old = mk({ archived: 'face' }, { pinned: ['a'] });
  assert.doesNotMatch(old, /data-action="(un)?pin"/);
});
