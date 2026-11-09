// The Messages screen on the host's facts (spec 2026-10-19 §7; one-entry plan 2 Task 5): Gravit's one conversation — its head,
// thread, composer and the rail of tasks beside it, or one line while it is off or unknown — and the Details drawer with This
// task, Usage, Background jobs, the children and Stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentConversation, renderMessagesScreen, renderHead, renderComposer, renderDetails, renderStatus } from '../../client/js/render/messages.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';
import { withTable } from '../../client/js/i18n/words.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const count = (h, re) => (h.match(re) ?? []).length;
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const channels = [{ workspaceId: 'w0', name: 'workbench', isRoot: true }, { workspaceId: 'w1', name: 'alpha', isRoot: false }];
const bots = [{ id: 'buffett', name: 'Buffett Type' }];
// Messages with `open` the conversation /data/tasks names
const listed = (convs, open = convs[0]?.id ?? null) => R.nav(R.tasksLoaded(R.hostList(emptyState(), { conversations: convs, channels, bots }), { conversation: open, tasks: [], at: NOW }), { screen: 'messages', id: null });

test('currentConversation is the conversation /data/tasks names on Messages, and none while it is unknown or elsewhere', () => {
  const s = listed([conv('a'), conv('b')], 'b');
  assert.equal(currentConversation(s).id, 'b');
  assert.equal(currentConversation({ ...s, route: { screen: 'messages', id: 'a' } }), null, 'an old link waiting to land binds nothing');
  assert.equal(currentConversation({ ...s, conversations: [] }), null, 'one the list does not carry yet');
  assert.equal(currentConversation(R.tasksOff(s, { at: NOW })), null, 'no conversation (FACE_ROUTER=0)');
  assert.equal(currentConversation({ ...s, route: { screen: 'history', id: 'a' } }), null, 'no composer target off Messages');
  assert.equal(currentConversation(R.nav(R.hostList(emptyState(), { conversations: [conv('a')], channels, bots }), { screen: 'messages', id: null })), null, 'none while the tasks load');
});

test('the head reads Gravit, a Working chip only while the host runs a turn, and Details', () => {
  const s = listed([conv('a', { title: 'BTC under 70k' })]);
  const quiet = renderHead(currentConversation(s), s);
  assert.match(quiet, /^<header class="head"><h1 class="head-title">Gravit<\/h1>/);
  assert.doesNotMatch(quiet, /BTC under 70k/, "the session's own title is not drawn");
  assert.doesNotMatch(quiet, /status up/);
  assert.match(quiet, /data-action="toggleDetails"[^>]*aria-expanded="false"/);
  const busy = renderHead({ ...currentConversation(s), running: true }, { ...s, detailsOpen: true });
  assert.match(busy, /class="status up"><span class="status-dot"><\/span>Working</);
  assert.match(busy, /aria-expanded="true"/);
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

test("the conversation and its empty state pass the draft's files and note on", () => {
  const composer = { menu: null, files: [{ key: 'f1', kind: 'file', name: 'a.csv', bytes: 2048, mediaType: 'text/csv', status: 'ready', loaded: 0 }], note: 'Up to 20 images a message' };
  const s = listed([conv('a')]);
  for (const h of [renderMessagesScreen(s, NOW, composer), renderMessagesScreen(listed([], 'c0'), NOW, composer)]) {
    assert.match(h, /id="composer-files"><div class="file-card">/);
    assert.match(h, /role="status">Up to 20 images a message<\/div>/);
  }
  assert.match(renderMessagesScreen(s, NOW, { menu: null }), /id="composer-files"><\/div>/, 'a composer with no files key draws an empty rail');
});

test('the composer says Tell Gravit…, and a menu handed in is drawn in the slot', () => {
  const menu = { kind: '@', from: 0, query: '', groups: [{ label: 'Bots in this room', items: [{ kind: 'bot', id: 'buffett', name: 'Buffett Type', description: '' }] }], active: 0 };
  const s = listed([conv('a')]);
  const h = renderMessagesScreen(s, NOW, { menu });
  assert.match(h, /data-placeholder="Tell Gravit…"/);
  assert.match(h, /<div class="composer-menu" id="composer-menu"><div class="cmenu" role="listbox" aria-label="References">/);
  assert.match(renderMessagesScreen(s, NOW), /<div class="composer-menu" id="composer-menu"><\/div>/, 'no menu by default');
  // the empty state passes it on too
  assert.match(renderMessagesScreen(listed([], 'c0'), NOW, { menu }), /id="composer-menu"><div class="cmenu"/);
});

test('the status line under the composer carries the host\'s word, marked bad when it is', () => {
  assert.equal(renderStatus({ line: '', bad: false, connected: true }), '');
  assert.equal(renderStatus({ line: 'Reconnecting…', bad: true, connected: false }), '<div class="status-line bad" role="status">Reconnecting…</div>');
  const s = R.hostStatus(listed([conv('a')]), { line: 'sent', bad: false });
  assert.match(renderMessagesScreen(s, NOW), /class="status-line" role="status">sent</);
});

test('Details: This task with its facts, Usage when the host reported it, Stop only while running', () => {
  const quiet = listed([conv('a', { title: 'BTC under 70k', created: NOW - 3 * 24 * 60 * MIN })]);
  const h = renderDetails(currentConversation(quiet), quiet);
  assert.match(h, /dsec-title">Gravit</);
  assert.match(h, />Agent<[\s\S]*?>Gravit</);
  assert.match(h, />Created</);
  for (const gone of ['Limit', 'wallet', 'Mode', 'withdraw', 'Beast', 'stopGravit', 'Usage', 'Members', 'Where', 'BTC under 70k']) assert.doesNotMatch(h, new RegExp(gone), gone);
  const busy = listed([conv('b', { running: true, usage: { tokenUsage: { uncachedInputTokens: 8123, outputTokens: 2411, cacheReadTokens: 51200, cacheWriteTokens: 900 }, contextPressure: 0.42 } })]);
  const d = renderDetails(currentConversation(busy), busy);
  assert.match(d, /data-action="stopGravit"[^>]*data-conv="b"/);
  assert.match(d, />Tokens in<[\s\S]*?>59,323</); assert.match(d, />Tokens out<[\s\S]*?>2,411</); assert.match(d, />Context<[\s\S]*?>42%</);
  const asking = R.askConfirm(busy, { action: 'stopGravit', id: 'b' });
  assert.match(renderDetails(currentConversation(asking), asking), /data-action="confirmYes"/);
});

test('Details offers no rename, fork, pin, archive or delete: the conversation is one and stays', () => {
  const said = { id: 'e1', seq: 1, at: NOW, from: 'you', kind: 'text', text: 'hi', data: {} };
  const s = listed([conv('a', { archived: false, loaded: true, messages: [said] })]);
  const h = renderDetails(currentConversation(s), { ...s, pinned: ['a'] });
  for (const gone of ['changeWords', 'fork', 'pin', 'unpin', 'archive', 'unarchive', 'deleteConv']) assert.doesNotMatch(h, new RegExp(`data-action="${gone}"`), gone);
});

test('the empty state offers three plain prompts', () => {
  const h = renderMessagesScreen(listed([], 'c0'), NOW);
  assert.equal(count(h, /data-action="suggest"/g), 3);
  assert.match(h, /Nothing handed to Gravit yet/);
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
test("a conversation's thread sits in its box beside an empty turn rail; the empty state has neither", () => {
  const s = listed([conv('a')]);
  const h = renderMessagesScreen(s, NOW);
  assert.match(h, /<div class="thread-box"><div class="thread" id="thread">[\s\S]*<\/div><nav class="turn-rail" id="turn-rail" aria-label="Turns" role="toolbar" aria-orientation="vertical"><\/nav><\/div>/);
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
  assert.match(h, /<\/form><div class="thread-foot"><div class="status-line" role="status">Reconnecting…<\/div><button type="button" class="stats-pill" id="pill-figures-a" data-action="openUsage" aria-label="7 turns · 41 steps · 38 tok\/s, open Usage">7 turns · 41 steps · 38 tok\/s<\/button><button type="button" class="stats-pill" id="pill-tokens-a" data-action="openUsage" aria-label="182k tokens · cache 63%, open Usage">182k tokens · cache 63%<\/button><\/div>/);
  // no usage yet: the second pill would be empty, so it is not drawn
  const bare = renderMessagesScreen(R.hostStatus(listed([conv('a', { stats: { ...STATS, turns: 1, steps: 1, decodeMs: 0 } })]), { line: '' }), NOW);
  assert.match(bare, /<div class="thread-foot"><button type="button" class="stats-pill" id="pill-figures-a" data-action="openUsage" aria-label="1 turn · 1 step, open Usage">1 turn · 1 step<\/button><\/div>/);
  assert.equal(count(bare, /stats-pill/g), 1);
});

// plan 6, Task 11: a pill says what it does to a screen reader
test('a pill names its action', () => {
  const s = R.hostStatus(listed([conv('a', { stats: { ...STATS, decodeMs: 0 } })]), { line: '' });
  const h = renderMessagesScreen(s, NOW);
  assert.match(h, /<button type="button" class="stats-pill" id="pill-figures-a" data-action="openUsage" aria-label="7 turns · 41 steps, open Usage">7 turns · 41 steps<\/button>/);
});

test('the rail is a vertical toolbar named Turns', () => {
  const h = renderMessagesScreen(listed([conv('a')]), NOW);
  assert.match(h, /<nav class="turn-rail" id="turn-rail" aria-label="Turns" role="toolbar" aria-orientation="vertical">/);
});

test('no stats, no pills: the foot is the status line alone, or nothing', () => {
  const quiet = R.hostStatus(listed([conv('a', { stats: { ...STATS, steps: 0 } })]), { line: '' });
  assert.doesNotMatch(renderMessagesScreen(quiet, NOW), /thread-foot|stats-pill/);
  const said = renderMessagesScreen(R.hostStatus(quiet, { line: 'Reconnecting…', bad: true }), NOW);
  assert.match(said, /<\/form><div class="thread-foot"><div class="status-line bad" role="status">Reconnecting…<\/div><\/div>/);
  assert.doesNotMatch(said, /stats-pill/);
  // the empty state keeps the status line alone
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
  assert.match(fold, /<span class="job-meta">bash · signal SIGTERM · /);
  assert.match(fold, /<span class="job-meta">bash · failed · /);
  assert.equal(count(fold, /class="job-end"/g), 1, 'the end line in the meta line alone; .job-end for (no output) only');
  assert.match(fold, /<div class="job-end">\(no output\)<\/div>/);
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

test("a finished job's end line is drawn once", () => {
  const s = withJobs([
    job('f1', 'completed', { detail: 'exit code: 0', finishedAt: NOW - 1000 }),
    job('f2', 'completed', { detail: 'exit code: 0', output: { total: 0, earliest: 0 }, finishedAt: NOW }),
  ]);
  const d = details(s);
  const one = d.match(/<details id="jobd-f1"[\s\S]*?<\/details>/)[0];
  assert.equal(count(one, /exit 0/g), 1, 'exit 0 once, in the meta line');
  assert.doesNotMatch(one, /job-end/);
  const empty = d.match(/<details id="jobd-f2"[\s\S]*?<\/details>/)[0];
  assert.equal(count(empty, /exit 0/g), 1);
  assert.match(empty, /<div class="job-end">\(no output\)<\/div>/);
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

// a title is derived from the first prompt and can hold a key: the conversation's head and Details name Gravit and never draw it
test("the head and Details' This task never draw the session's title", () => {
  const SK = 'sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4';
  const one = listed([conv('a', { title: `use ${SK}` })]);
  assert.match(renderHead(currentConversation(one), one), /head-title">Gravit</);
  assert.match(renderDetails(currentConversation(one), one), /dsec-title">Gravit</);
  assert.doesNotMatch(renderHead(currentConversation(one), one), /sk-proj/);
  assert.doesNotMatch(renderDetails(currentConversation(one), one), /sk-proj/);
});

test("Details' turns and steps, a child's mode and state and a live job's meta and clock are in the table's order", () => {
  const s = listed([conv('a', { usage: { tokenUsage: TOKENS }, stats: STATS })]);
  assert.match(withTable({ 'details.turnsStepsValue': '{steps} / {turns}' }, () => renderDetails(currentConversation(s), s)), />Turns · steps<[\s\S]*?>41 \/ 7</);
  const c = R.hostList(listed([conv('a', { live: true, subagentCatalog: [{ id: 'once', createdAt: 2, mode: 'one-shot' }] })]),
    { conversations: [conv('a', { live: true })], childRows: [{ sessionId: 'once', parentSessionId: 'a', running: false, origin: 'subagent' }] });
  assert.match(withTable({ 'details.childMeta': '{state} ({mode})' }, () => renderDetails(currentConversation(c), c)), /Subagent[\s\S]*?Not running \(One-shot\)/);
  const j = withJobs([job('j1', 'running', { progress: 'page 7 of 12' })]);
  assert.match(withTable({ 'jobs.metaClock': '{clock} ← {meta}' }, () => details(j)), /<span class="job-meta"><span data-job-clock="\d+">3m 04s<\/span> ← bash · page 7 of 12<\/span>/);
});

// ---- Messages is the one conversation (one-entry plan 2 Task 5)
const taskRow = (id, over = {}) => ({ id, title: `Task ${id}`, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW - 3 * MIN, lastEventAt: NOW - MIN, lastSeq: 1, ...over });

test('Messages draws the conversation, its composer and the rail', () => {
  const said = { id: 'e1', seq: 1, at: NOW, from: 'gravit', kind: 'text', text: 'On it', data: {} };
  const s = R.tasksLoaded(listed([conv('c', { loaded: true, messages: [said] })], 'c'), { conversation: 'c', tasks: [taskRow('t1', { title: 'Read the tape' })], at: NOW });
  const h = renderMessagesScreen(s, NOW);
  // the head, then the two columns: the conversation (thread, composer, foot) and the rail on its right
  assert.match(h, /^<main class="main"><header class="head"><h1 class="head-title">Gravit<\/h1>[\s\S]*?<\/header><div class="conv-cols"><div class="conv-col"><div class="thread-box">/);
  assert.match(h, /On it/);
  assert.ok(h.indexOf('class="composer"') > h.indexOf('class="thread-box"'), 'the composer under the thread');
  const col = h.indexOf('class="conv-col"'); const rail = h.indexOf('<aside class="tasks"');
  assert.ok(rail > h.indexOf('class="composer"') && rail > col, 'the rail after the conversation column, laid out on its right');
  assert.match(h, /Read the tape/);
  assert.equal(count(h, /class="composer"/g), 1, 'one composer');
  for (const gone of ['nm-where', 'nm-title', 'draftWhere', 'draftTitle', 'cancelDraft', 'startDraft']) assert.doesNotMatch(h, new RegExp(gone), gone);
  // no task under way: no rail, the conversation column alone
  assert.doesNotMatch(renderMessagesScreen(listed([conv('c')], 'c'), NOW), /class="tasks"/);
});

test('with tasks off it says the conversation is off and draws no composer', () => {
  const off = R.tasksOff(R.nav(R.hostList(emptyState(), { conversations: [conv('a')], channels, bots }), { screen: 'messages', id: null }), { at: NOW });
  const h = renderMessagesScreen(off, NOW);
  assert.match(h, /<header class="head"><h1 class="head-title">Gravit<\/h1><\/header>/);
  assert.match(h, /Gravit's conversation is off/);
  assert.doesNotMatch(h, /class="composer"|id="say"|class="tasks"|data-action="suggest"/);
  const failed = renderMessagesScreen(R.tasksFailed(R.nav(R.hostList(emptyState(), { conversations: [conv('a')], channels, bots }), { screen: 'messages', id: null }), { at: NOW }), NOW);
  assert.match(failed, /Gravit's conversation could not be read/);
  assert.doesNotMatch(failed, /class="composer"|id="say"/);
  // a face that names no conversation reads as off
  assert.match(renderMessagesScreen(listed([conv('a')], null), NOW), /Gravit's conversation is off/);
  // a re-read that fails keeps the conversation it last read, its composer with it
  const kept = renderMessagesScreen(R.tasksFailed(listed([conv('a')], 'a'), { at: NOW }), NOW);
  assert.match(kept, /class="composer"/);
  assert.doesNotMatch(kept, /could not be read/);
});

test('while tasks load it draws no composer', () => {
  const loading = R.nav(R.hostList(emptyState(), { conversations: [conv('a')], channels, bots }), { screen: 'messages', id: null });
  const h = renderMessagesScreen(loading, NOW);
  assert.match(h, /<h1 class="head-title">Gravit<\/h1>/);
  assert.match(h, />Loading…</);
  assert.doesNotMatch(h, /class="composer"|id="say"/);
  // an old link waiting on the tasks binds nothing either
  assert.doesNotMatch(renderMessagesScreen({ ...loading, route: { screen: 'messages', id: 'a' } }, NOW), /class="composer"|id="say"/);
  assert.match(renderMessagesScreen(R.hostStatus(loading, { line: 'connecting…' }), NOW), /status-line" role="status">connecting…</);
});
