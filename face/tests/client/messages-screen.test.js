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

test('the composer is the menu slot, the note, the box with the rail, the editor and Send', () => {
  const h = renderComposer();
  assert.match(h, /<form class="composer" data-action="send"><div class="composer-menu" id="composer-menu"><\/div><div class="composer-note" id="composer-note" role="status"><\/div><div class="composer-box"><div class="composer-files" id="composer-files"><\/div><div class="composer-row"><button type="button" class="attach-key"/);
  assert.match(h, /<button type="submit" class="send-key" aria-label="Send"><svg[\s\S]*?<\/svg><\/button><\/div><\/div><\/form>$/, 'Send ends the row, the row ends the box');
  assert.match(h, /<span id="say-label" class="sr-only">Tell Gravit<\/span>/);
  const editor = h.match(/<div id="say"([^>]*)><\/div>/)?.[1];
  assert.ok(editor, 'the editor is an empty div#say');
  for (const a of ['class="composer-input"', 'contenteditable="true"', 'role="textbox"', 'aria-multiline="true"', 'aria-labelledby="say-label"', 'aria-controls="composer-menu"', 'aria-expanded="false"', 'data-placeholder="Tell Gravit…"']) assert.ok(editor.includes(a), a);
  assert.doesNotMatch(h, /<input id="say"/);
  assert.doesNotMatch(h, /composer-pill/);
  assert.match(h, /class="send-key" aria-label="Send"/);
  assert.match(renderComposer({ placeholder: 'Tell Gravit… @ a bot by name' }), /data-placeholder="Tell Gravit… @ a bot by name"/);
});

test('the composer has the paperclip and a hidden file input, no mic', () => {
  const h = renderComposer();
  const clip = h.match(/<button([^>]*data-action="attachFiles"[^>]*)>([\s\S]*?)<\/button>/);
  assert.ok(clip, 'the paperclip key');
  for (const a of ['type="button"', 'class="attach-key"', 'aria-label="Attach files"']) assert.ok(clip[1].includes(a), a);
  assert.match(clip[2], /^<svg width="18" height="18"/);
  const input = h.match(/<input([^>]*id="attach-input"[^>]*)>/)?.[1];
  assert.ok(input, 'the hidden file input');
  for (const a of ['type="file"', 'class="sr-only"', ' multiple', 'tabindex="-1"', 'aria-hidden="true"']) assert.ok(input.includes(a), a);
  const box = h.indexOf('class="composer-box"');
  assert.ok(box > 0 && h.indexOf('id="composer-files"') > box && h.indexOf('id="composer-files"') < h.indexOf('id="say"'), 'the rail inside the box, before the editor');
  assert.ok(h.indexOf('id="attach-input"') > box && h.indexOf('data-action="attachFiles"') < h.indexOf('id="say"'), 'the paperclip before the editor');
  assert.ok(h.indexOf('id="composer-note"') < box, 'the note outside the box');
  for (const gone of ['toggleMic', 'pickFile']) assert.doesNotMatch(h, new RegExp(gone));
});

test('a note handed in is drawn above the box, escaped', () => {
  const h = renderComposer({ note: "Gravit's model takes <no> images." });
  assert.match(h, /<div class="composer-note" id="composer-note" role="status">Gravit&#39;s model takes &lt;no&gt; images\.<\/div><div class="composer-box">/);
});

test("the three screens pass the draft's files and note on", () => {
  const composer = { menu: null, files: [{ key: 'f1', kind: 'file', name: 'a.csv', bytes: 2048, mediaType: 'text/csv', status: 'ready', loaded: 0 }], note: 'Up to 20 images a message' };
  const s = listed([conv('a')]);
  for (const h of [renderMessagesScreen(s, NOW, composer), renderMessagesScreen(R.startDraft(s, {}), NOW, composer), renderMessagesScreen(listed([]), NOW, composer)]) {
    assert.match(h, /id="composer-files"><div class="file-card">/);
    assert.match(h, /role="status">Up to 20 images a message<\/div>/);
  }
  assert.match(renderMessagesScreen(s, NOW, { menu: null }), /id="composer-files"><\/div>/, 'a composer with no files key draws an empty rail');
});

test("a group's composer keeps its @ placeholder, and a menu handed in is drawn in the slot", () => {
  const menu = { kind: '@', from: 0, query: '', groups: [{ label: 'Bots in this room', items: [{ kind: 'bot', id: 'buffett', name: 'Buffett Type', description: '' }] }], active: 0 };
  const group = listed([conv('g', { kind: 'group', members: ['gravit', 'buffett'] })]);
  const h = renderMessagesScreen(group, NOW, { menu });
  assert.match(h, /data-placeholder="Tell Gravit… @ a bot by name"/);
  assert.match(h, /<div class="composer-menu" id="composer-menu"><div class="cmenu" role="listbox" aria-label="References">/);
  assert.match(renderMessagesScreen(group, NOW), /<div class="composer-menu" id="composer-menu"><\/div>/, 'no menu by default');
  // the new-message screen and the empty state pass it on too
  assert.match(renderMessagesScreen(R.startDraft(group, {}), NOW, { menu }), /id="composer-menu"><div class="cmenu"/);
  assert.match(renderMessagesScreen(listed([]), NOW, { menu }), /id="composer-menu"><div class="cmenu"/);
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

test("Details' Pin and Unpin key carries one stable id, so focus finds it after the press flips it", () => {
  const said = { id: 'e1', seq: 1, at: NOW, from: 'you', kind: 'text', text: 'hi', data: {} };
  const mk = extra => { const s = { ...listed([conv('a', { archived: false, loaded: true, messages: [said] })]), ...extra }; return renderDetails(currentConversation(s), s); };
  assert.match(mk({}), /data-action="pin" data-conv="a" id="details-pin-a">Pin</);
  assert.match(mk({ pinned: ['a'] }), /data-action="unpin" data-conv="a" id="details-pin-a">Unpin</);
});

test("the editor says whether its menu is open, and which row is active, as it is drawn", () => {
  const menu = { kind: '@', from: 0, query: '', groups: [{ label: 'Bots in this room', items: [{ kind: 'bot', id: 'a', name: 'A', description: '' }, { kind: 'bot', id: 'b', name: 'B', description: '' }] }], active: 1 };
  const open = renderComposer({ menu }).match(/<div id="say"([^>]*)>/)[1];
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /aria-activedescendant="cm-1"/);
  const shut = renderComposer().match(/<div id="say"([^>]*)>/)[1];
  assert.match(shut, /aria-expanded="false"/);
  assert.doesNotMatch(shut, /aria-activedescendant/);
});

// ---- the thread box and the earlier key (plan 5 task 4)
test("a conversation's thread sits in its box beside an empty rail; New message keeps a bare thread", () => {
  const s = listed([conv('a')]);
  const h = renderMessagesScreen(s, NOW);
  assert.match(h, /<div class="thread-box"><div class="thread" id="thread">[\s\S]*<\/div><nav class="turn-rail" id="turn-rail" aria-label="Turns"><\/nav><\/div>/);
  const draft = renderMessagesScreen(R.startDraft(s), NOW);
  assert.match(draft, /<div class="thread" id="thread"><\/div>/);
  assert.doesNotMatch(draft, /thread-box|turn-rail/);
  const empty = renderMessagesScreen({ ...s, conversations: [] }, NOW);
  assert.doesNotMatch(empty, /thread-box|turn-rail/);
});

test('Earlier messages shows while the window has more, Loading… aria-disabled while it loads, nothing without more', () => {
  const at = window => renderMessagesScreen(listed([conv('a', { window })]), NOW);
  const more = at({ start: 30, through: 40, hasMore: true, replaced: [] });
  assert.match(more, /<div class="thread" id="thread"><button class="btn-sm earlier-key" type="button" id="earlier-a" data-action="earlier" data-conv="a">Earlier messages<\/button>/);
  const loading = at({ start: 30, through: 40, hasMore: true, replaced: [], loading: true });
  assert.match(loading, /<button class="btn-sm earlier-key" type="button" id="earlier-a" data-action="earlier" data-conv="a" aria-disabled="true">Loading…<\/button>/, 'still focusable while it reads');
  assert.doesNotMatch(loading, /earlier-key[^>]*\sdisabled/);
  assert.doesNotMatch(at({ start: 0, through: 40, hasMore: false, replaced: [] }), /earlier-key/);
  assert.doesNotMatch(at(undefined), /earlier-key/);
});

test("the thread's anchor: the first message drawn at or past the seq the page names carries data-anchor, once", () => {
  const msg = (id, seq) => ({ id, seq, at: NOW, from: 'you', kind: 'text', text: 'w' + seq, data: {} });
  const s = listed([conv('a', { messages: [msg('m10', 10), msg('m30', 30), msg('m31', 31)] })]);
  const h = renderMessagesScreen(s, NOW, {}, { anchor: 20 });
  assert.equal(count(h, /data-anchor/g), 1);
  assert.match(h, /<div data-anchor class="msg you"><div class="bubble you">w30</);
  assert.doesNotMatch(renderMessagesScreen(s, NOW), /data-anchor/, 'no anchor named, none drawn');
});

// plan 5, Task 6: the session's figures (D21) in Usage and as two pills under the composer
const STATS = { turns: 7, steps: 41, llmMs: 252_000, toolMs: 42_400, ttftMs: 57_400, ttftSteps: 41, decodeMs: 60_000, decodeTokens: 2280 };
const TOKENS = { uncachedInputTokens: 67_000, cacheReadTokens: 113_000, outputTokens: 2_000 };

test('Usage keeps its three rows and gains cache hit, turns and steps, model and tool time, first token and speed', () => {
  const s = listed([conv('a', { usage: { tokenUsage: TOKENS, contextPressure: 0.42 }, stats: STATS })]);
  const d = renderDetails(currentConversation(s), s);
  assert.match(d, /<section class="dsec" id="dsec-usage"><div class="dsec-label">Usage<\/div>/);
  const labels = [...d.slice(d.indexOf('dsec-usage')).matchAll(/kv-k">([^<]*)</g)].map(x => x[1]);
  assert.deepEqual(labels.slice(0, 9), ['Tokens in', 'Tokens out', 'Context', 'Cache hit', 'Turns · steps', 'Model time', 'Tool time', 'First token', 'Speed']);
  assert.match(d, />Tokens in<[\s\S]*?>180,000</);
  assert.match(d, />Cache hit<[\s\S]*?>63%</);
  assert.match(d, />Turns · steps<[\s\S]*?>7 · 41</);
  assert.match(d, />Model time<[\s\S]*?>4m 12s</);
  assert.match(d, />Tool time<[\s\S]*?>42 s</);
  assert.match(d, />First token<[\s\S]*?>1.4 s</);
  assert.match(d, />Speed<[\s\S]*?>38 tok\/s</);
  // a row with no figure is not drawn: no tool time yet, no decode yet, no usage yet (no cache hit)
  const early = listed([conv('a', { stats: { ...STATS, toolMs: 0, decodeMs: 0, decodeTokens: 0 } })]);
  const e = renderDetails(currentConversation(early), early);
  assert.match(e, /id="dsec-usage"/, 'the figures alone draw the section');
  for (const gone of ['Tool time', 'Speed', 'Cache hit', 'Tokens in']) assert.doesNotMatch(e, new RegExp(`>${gone}<`), gone);
  assert.match(e, />Model time<[\s\S]*?>4m 12s</);
  const unmeasured = listed([conv('a', { stats: { ...STATS, ttftMs: 0 } })]);
  assert.doesNotMatch(renderDetails(currentConversation(unmeasured), unmeasured), />First token</, 'no 0.0 s first token');
  // before the first step: no figures, and no section without usage
  const none = listed([conv('a', { stats: { ...STATS, steps: 0 } })]);
  assert.doesNotMatch(renderDetails(currentConversation(none), none), /Usage/);
});

test('the pills show after the first step, right of the status line, and open Usage', () => {
  const s = R.hostStatus(listed([conv('a', { usage: { tokenUsage: TOKENS }, stats: STATS })]), { line: 'Reconnecting…' });
  const h = renderMessagesScreen(s, NOW);
  assert.match(h, /<\/form><div class="thread-foot"><div class="status-line" role="status">Reconnecting…<\/div><button type="button" class="stats-pill" id="pill-figures-a" data-action="openUsage">7 turns · 41 steps · 38 tok\/s<\/button><button type="button" class="stats-pill" id="pill-tokens-a" data-action="openUsage">182k tokens · cache 63%<\/button><\/div>/);
  // no usage yet: the second pill would be empty, so it is not drawn
  const bare = renderMessagesScreen(R.hostStatus(listed([conv('a', { stats: { ...STATS, turns: 1, steps: 1, decodeMs: 0 } })]), { line: '' }), NOW);
  assert.match(bare, /<div class="thread-foot"><button type="button" class="stats-pill" id="pill-figures-a" data-action="openUsage">1 turn · 1 step<\/button><\/div>/);
  assert.equal(count(bare, /stats-pill/g), 1);
});

test('no stats, no pills: the foot is the status line alone, or nothing', () => {
  const quiet = R.hostStatus(listed([conv('a', { stats: { ...STATS, steps: 0 } })]), { line: '' });
  assert.doesNotMatch(renderMessagesScreen(quiet, NOW), /thread-foot|stats-pill/);
  const said = renderMessagesScreen(R.hostStatus(quiet, { line: 'Reconnecting…', bad: true }), NOW);
  assert.match(said, /<\/form><div class="thread-foot"><div class="status-line bad" role="status">Reconnecting…<\/div><\/div>/);
  assert.doesNotMatch(said, /stats-pill/);
  // New message and the empty state keep the status line alone
  const draft = renderMessagesScreen(R.hostStatus(R.startDraft(quiet), { line: 'Reconnecting…' }), NOW);
  assert.match(draft, /<\/form><div class="status-line" role="status">Reconnecting…<\/div><\/main>/);
  assert.doesNotMatch(draft, /thread-foot/);
  const empty = renderMessagesScreen(R.hostStatus({ ...quiet, conversations: [] }, { line: 'Reconnecting…' }), NOW);
  assert.doesNotMatch(empty, /thread-foot/);
});

// ---- background jobs (plan 5, Task 9): the chip in the head, Details › Background jobs
const job = (id, status, more = {}) => ({ id, kind: 'bash', label: `run ${id}`, owner: 'a', status, startedAt: NOW - 184_000, output: { total: 10, earliest: 0 }, ...more });
const withJobs = (rows, s = listed([conv('a')])) => R.hostJobs(R.watchJobs(s, 'a'), { convId: 'a', jobs: rows });
const details = s => renderDetails(currentConversation(s), s, NOW);

test('the chip shows while the conversation has a job, with its words, and none without', () => {
  const head = s => renderHead(currentConversation(s), s);
  assert.doesNotMatch(head(listed([conv('a')])), /jobs-chip/);
  assert.doesNotMatch(head(withJobs([])), /jobs-chip/);
  const one = head(withJobs([job('j1', 'running')]));
  assert.match(one, /<button type="button" class="btn-sm jobs-chip" data-action="openJobs"><span class="jobs-dot live"><\/span>1 job running<svg/);
  assert.match(head(withJobs([job('j1', 'running'), job('j2', 'stopping'), job('j3', 'completed')])), />2 jobs running</);
  const done = head(withJobs([job('j1', 'completed'), job('j2', 'failed')]));
  assert.match(done, /<span class="jobs-dot"><\/span>2 jobs finished/);
  // before Working
  const busy = head(withJobs([job('j1', 'running')], listed([conv('a', { running: true })])));
  assert.ok(busy.indexOf('jobs-chip') < busy.indexOf('Working'), 'the chip before Working');
  // another conversation's rows are not this one's
  const other = R.hostJobs(R.watchJobs(listed([conv('a'), conv('b')], 'b'), 'a'), { convId: 'a', jobs: [job('j1', 'running')] });
  assert.doesNotMatch(head(other), /jobs-chip/);
});

test('Background jobs sits right after This task: a running job\'s command, meta and Stop; a stopping one Stopping', () => {
  const s = withJobs([job('j1', 'running', { progress: 'page 7 of 12' }), job('j2', 'stopping')]);
  const d = details(s);
  assert.match(d, /This task<\/div>[\s\S]*?<\/section>\s*<section class="dsec" id="dsec-jobs"><div class="dsec-label">Background jobs<\/div>/);
  assert.match(d, /<div class="job"><details id="jobd-j1" class="job-details"><summary data-action="openJob" data-job="j1"><span class="job-dot live"><\/span><code class="job-cmd">run j1<\/code><span class="job-meta">bash · page 7 of 12 · <span data-job-clock="\d+">3m 04s<\/span><\/span><\/summary>/);
  assert.match(d, /<pre class="job-out" id="jobout-j1"><\/pre>/, 'the output pre is drawn empty');
  assert.match(d, /<button type="button" class="btn-sm job-copy" id="job-copy-j1" data-action="copyText" data-text="run j1" aria-label="Copy command">Copy<\/button>/);
  assert.match(d, /<button type="button" class="btn-sm" id="job-stop-j1" data-action="stopJob" data-conv="a" data-job="j1">Stop<\/button>/);
  assert.match(d, /id="jobd-j2"[\s\S]*?<\/details><span class="dim" id="job-stopping-j2" tabindex="-1">Stopping<\/span><\/div>/);
  assert.doesNotMatch(d, /data-job="j2">Stop</);
  assert.doesNotMatch(d, /jobs-finished/, 'no fold without finished jobs');
  // the open job is drawn open
  assert.match(details(R.openJob(s, 'j1')), /<details id="jobd-j1" class="job-details" open>/);
  // no jobs, no section
  assert.doesNotMatch(details(listed([conv('a')])), /dsec-jobs/);
});

test('Stop asks twice with Yes, stop', () => {
  const s = R.askConfirm(withJobs([job('j1', 'running'), job('j2', 'running')]), { action: 'stopJob', id: 'j1', conv: 'a' });
  const d = details(s);
  assert.match(d, /id="jobd-j1"[\s\S]*?<\/details><span class="confirm"><button type="button" class="btn-danger" data-action="confirmYes">Yes, stop<\/button>/);
  assert.match(d, /data-action="stopJob" data-conv="a" data-job="j2">Stop</, 'the other job keeps its Stop');
});

test('finished jobs fold under Finished · n with Clear, their end lines and (no output) for an empty one', () => {
  const s = withJobs([
    job('r1', 'running'),
    job('f1', 'completed', { detail: 'exit code: 3', finishedAt: NOW - 120_000 }),
    job('f2', 'killed', { detail: 'signal: SIGTERM', finishedAt: NOW - 1000 }),
    job('f3', 'failed', { output: { total: 0, earliest: 0 }, finishedAt: NOW }),
  ]);
  const d = details(s);
  assert.match(d, /<details id="jobs-finished-a" class="jobs-finished"><summary>Finished · 3<\/summary>/);
  const fold = d.slice(d.indexOf('jobs-finished-a'));
  assert.match(fold, /<span class="job-dot"><\/span><code class="job-cmd">run f1<\/code><span class="job-meta">bash · exit 3 · 1m 04s<\/span>/);
  assert.match(fold, /<div class="job-end">exit 3<\/div>/);
  assert.match(fold, /<div class="job-end">signal SIGTERM<\/div>/);
  assert.match(fold, /<div class="job-end">\(no output\) · failed<\/div>/);
  assert.doesNotMatch(fold, /data-action="stopJob"/, 'no Stop on a finished job');
  assert.doesNotMatch(fold, /data-job-clock/, 'a finished job has no ticking clock');
  assert.match(fold, /<button type="button" class="btn-sm" id="jobs-clear-a" data-action="clearJobs" data-conv="a">Clear<\/button><\/details>/);
  assert.equal(count(d.slice(0, d.indexOf('jobs-finished-a')), /class="job"/g), 1, 'one running row above the fold');
  // cleared: the fold goes; with no running job either the section goes
  const cleared = R.clearJobs(s, 'a');
  assert.doesNotMatch(details(cleared), /jobs-finished/);
  assert.match(details(cleared), /dsec-jobs/);
  assert.doesNotMatch(details(R.clearJobs(withJobs([job('f1', 'completed')]), 'a')), /dsec-jobs/);
});

test("a job's command is escaped and never masked", () => {
  const key = 'sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4';
  const d = details(withJobs([job('j1', 'running', { label: `curl -H "x: ${key}" <a>&` })]));
  assert.match(d, /<code class="job-cmd">curl -H &quot;x: sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4&quot; &lt;a&gt;&amp;<\/code>/);
  assert.match(d, /data-text="curl -H &quot;x: sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4&quot; &lt;a&gt;&amp;"/);
  assert.doesNotMatch(d, /secret/);
});

test('the Finished fold is drawn open while it holds the open job', () => {
  const s = withJobs([job('r1', 'running'), job('f1', 'completed', { finishedAt: NOW })]);
  assert.match(details(s), /<details id="jobs-finished-a" class="jobs-finished"><summary>/);
  assert.match(details(R.openJob(s, 'f1')), /<details id="jobs-finished-a" class="jobs-finished" open><summary>/);
  assert.match(details(R.openJob(s, 'r1')), /<details id="jobs-finished-a" class="jobs-finished"><summary>/, 'a running job open leaves it as it is');
});
