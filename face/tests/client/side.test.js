// The side panel beside Messages and its pages (one-entry plan 2 Task 6): the search box, a Gravit row, a History row and the
// strategies; while a query stands, its results in place of the rows, each opening the task's page, history or Messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSide } from '../../client/js/render/side.js';
import { historyOf, strategiesOf } from '../../client/js/host/rail-view.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const count = (h, re) => (h.match(re) ?? []).length;
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const task = (id, over = {}) => ({ id, title: id, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW, lastEventAt: NOW, lastSeq: 1, ...over });
const CHANNELS = [
  { workspaceId: 'w0', name: 'workbench', isRoot: true },
  { workspaceId: 'w2', name: 'momentum', isRoot: false, status: 'paper' },
  { workspaceId: 'w1', name: 'cn-market', title: 'CN market', isRoot: false, status: 'researching' },
];
// `conversation` is the one /data/tasks names, `tasks` its tasks, on Messages
const listed = (convs, { conversation = convs[0]?.id ?? null, tasks = [], channels = CHANNELS, route = { screen: 'messages', id: null } } = {}) => {
  const s = R.hostList(emptyState(), { conversations: convs, channels, bots: [] });
  return R.nav(R.tasksLoaded(s, { conversation, tasks, at: NOW }), route);
};
const searched = (s, q, answer) => {
  let t = R.setSearchQuery(s, q);
  if (answer === 'failed') t = R.searchFailed(t, { query: q });
  else if (answer) t = R.searchContent(t, { query: q, ...answer });
  return t;
};

test('the panel holds Gravit, History and one row per strategy, root left out', () => {
  const s = listed([conv('c', { lastSeen: NOW }), conv('t1'), conv('h1', { updatedAt: NOW - 9 * MIN }), conv('h2', { updatedAt: NOW - MIN })], { conversation: 'c', tasks: [task('t1')] });
  const h = renderSide(s, NOW);
  const hrefs = [...h.matchAll(/<a class="row[^"]*"(?: aria-current="page")? href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(hrefs, ['#/messages', '#/history', '#/strategy/cn-market', '#/strategy/momentum'], 'Gravit, History, the strategies by name');
  assert.match(h, /href="#\/messages"><span class="dot"><\/span><span class="row-body"><span class="row-top"><span class="row-title">Gravit<\/span><\/span><\/span><\/a>/);
  assert.match(h, /href="#\/history"><span class="row-body"><span class="row-top"><span class="row-title">History<\/span><span class="row-note">2<\/span>/, 'its count: neither the conversation nor a task');
  assert.match(h, /<div class="grp-head"><span class="grp-name">Strategies<\/span><\/div>/);
  assert.match(h, /href="#\/strategy\/cn-market"><span class="row-body"><span class="row-top"><span class="row-title">CN market<\/span><span class="row-note">researching<\/span>/, "its title, its status word");
  assert.doesNotMatch(h, /workbench/, 'the root is no strategy');
  assert.doesNotMatch(h, /pin-key|grp-key|row-preview|data-action="open"/, 'no pins, folds, previews or row actions');
  assert.deepEqual(historyOf(s).map(c => c.id), ['h2', 'h1'], 'newest first');
  assert.deepEqual(strategiesOf(s).map(c => c.name), ['cn-market', 'momentum']);
  // the conversation moved after the operator last looked: Gravit's dot is on
  const unread = R.hostList(s, { conversations: [conv('c', { updatedAt: NOW + MIN, lastSeen: NOW })] });
  assert.match(renderSide(unread, NOW), /href="#\/messages"><span class="dot on">/);
  // a workspace whose directory is gone (the old folder's, after the repository's rename) is no strategy: the listing keeps
  // it as a record, the panel does not draw it
  const gone = { ...CHANNELS[1], workspaceId: 'ws-old', dir: '/old/strategies/cn-market', missingDir: true };
  const oldRoot = { ...CHANNELS[1], workspaceId: 'ws-old-root', name: 'evolving-alpha-us', dir: '/old', missingDir: true };
  const withGone = listed([conv('c')], { channels: [...CHANNELS, gone, oldRoot] });
  assert.deepEqual(strategiesOf(withGone).map(c => c.name), ['cn-market', 'momentum'], 'one row per live strategy');
  assert.doesNotMatch(renderSide(withGone, NOW), /evolving-alpha-us/);
  // no strategies: no head
  assert.doesNotMatch(renderSide(listed([conv('c')], { channels: [CHANNELS[0]] }), NOW), /grp-head/);
});

test("the current route's row is marked current", () => {
  const convs = [conv('c'), conv('h1'), conv('t1')];
  const current = route => [...renderSide(listed(convs, { conversation: 'c', tasks: [task('t1')], route }), NOW).matchAll(/class="row current" aria-current="page" href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(current({ screen: 'messages', id: null }), ['#/messages']);
  assert.deepEqual(current({ screen: 'history', id: null }), ['#/history']);
  assert.deepEqual(current({ screen: 'history', id: 'h1' }), ['#/history']);
  assert.deepEqual(current({ screen: 'strategy', id: 'momentum' }), ['#/strategy/momentum']);
  assert.deepEqual(current({ screen: 'task', id: 't1' }), [], 'a task is the rail\'s, no row here');
  for (const screen of ['markets', 'trade', 'discover', 'account']) assert.equal(renderSide(listed(convs, { route: { screen, id: null } }), NOW), '', `none beside ${screen}`);
  assert.match(renderSide(listed(convs, { route: { screen: 'task', id: 't1' } }), NOW), /class="list"/, 'beside a task page');
});

test('a search hit on a task opens its task page and any other opens history', () => {
  const s = listed([conv('c', { title: 'Moutai here' }), conv('t1', { title: 'Moutai task', updatedAt: NOW - MIN }), conv('h1', { title: 'Moutai old', updatedAt: NOW - 2 * MIN })], { conversation: 'c', tasks: [task('t1')] });
  const h = renderSide(searched(s, 'moutai'), NOW);
  const hrefs = [...h.matchAll(/<a class="conv-hit[^"]*" href="([^"]+)">/g)].map(m => m[1]);
  assert.deepEqual(hrefs.sort(), ['#/history/h1', '#/messages', '#/task/t1'], 'the conversation itself on Messages');
  assert.doesNotMatch(h, /data-action="open"|data-action="unarchive"/, 'links the browser follows; no Un-archive');
  assert.doesNotMatch(h, /class="rail-rows"/, 'no rows while a query stands');
});

test('names are escaped', () => {
  const channels = [{ workspaceId: 'w0', name: 'root', isRoot: true }, { workspaceId: 'w1', name: 'a"b', title: '<b>x</b>', isRoot: false, status: '<i>s</i>' }];
  const h = renderSide(listed([conv('c')], { channels }), NOW);
  assert.doesNotMatch(h, /<b>x<\/b>|<i>s<\/i>/);
  assert.match(h, /href="#\/strategy\/a%22b"><span class="row-body"><span class="row-top"><span class="row-title">&lt;b&gt;x&lt;\/b&gt;<\/span><span class="row-note">&lt;i&gt;s&lt;\/i&gt;<\/span>/);
});

test('the box sits under the panel head with its placeholder and key hint', () => {
  const s = listed([conv('a')]);
  const h = renderSide(s, NOW);
  assert.match(h, /<\/div><div class="list-body" id="conversation-list-body"><div class="conv-search"><svg[^>]*>[\s\S]*?<\/svg><input id="cq" type="search" autocomplete="off" placeholder="Search conversations" aria-label="Search conversations" data-action="convQuery" value=""><kbd class="conv-search-key">⌥⌘K<\/kbd><\/div><div class="rail-rows">/);
  assert.match(renderSide(s, NOW, { mac: false }), /<kbd class="conv-search-key">Ctrl\+Alt\+K<\/kbd>/, 'off a Mac');
  assert.match(renderSide(searched(s, 'T "a'), NOW), /data-action="convQuery" value="T &quot;a"/, "the box's value is the store's");
  assert.match(renderSide(listed([]), NOW), /class="conv-search"/, 'there with no conversation');
  // a blank query is no query: the rows as they were
  assert.equal(renderSide(searched(s, '   '), NOW), renderSide(s, NOW).replace('value=""', 'value="   "'));
});

test('a query shows the results and their count, newest first', () => {
  const s = listed([conv('a', { title: 'Moutai notes', channel: { workspaceId: 'w1', name: 'cn-market' } }), conv('b', { title: 'Other' }), conv('c', { title: 'moutai again', updatedAt: NOW - 1 * MIN })], { conversation: 'b' });
  const h = renderSide(searched(s, 'moutai'), NOW);
  assert.match(h, /<div class="conv-results"><div class="conv-results-count">2 conversations<\/div>/);
  assert.deepEqual([...h.matchAll(/class="conv-hit[^"]*" href="#\/history\/(\w+)"/g)].map(m => m[1]), ['c', 'a']);
  assert.match(h, /<span class="row-top"><span class="row-title">moutai again<\/span><span class="row-time">[^<]+<\/span><\/span><span class="conv-hit-line"><b class="conv-hit-channel">No channel<\/b>/);
  assert.match(h, /<b class="conv-hit-channel">CN market<\/b>/);
  assert.match(renderSide(searched(s, 'other'), NOW), /conv-results-count">1 conversation</);
});

test("the snippet's match is marked, and every host word is escaped", () => {
  const channels = [{ workspaceId: 'w0', name: 'root', isRoot: true }, { workspaceId: 'w1', name: '<i>c</i>', isRoot: false }];
  const s = listed([conv('a', { title: '<b>x</b>', channel: { workspaceId: 'w1', name: '<i>c</i>' } }), conv('b', { title: 'plain' })], { channels, conversation: 'z' });
  const h = renderSide(searched(s, 'zz', { items: [{ sessionId: 'b', snippet: 'say <zz> & go', match: [4, 8] }], hasMore: false }), NOW);
  assert.match(h, /<span class="conv-hit-line"><b class="conv-hit-channel">No channel<\/b> say <mark>&lt;zz&gt;<\/mark> &amp; go<\/span>/);
  const t = renderSide(searched(s, 'x'), NOW);
  assert.doesNotMatch(t, /<b>x<\/b>|<i>c<\/i>/);
  assert.match(t, /row-title">&lt;b&gt;x&lt;\/b&gt;</);
  assert.match(t, /conv-hit-channel">&lt;i&gt;c&lt;\/i&gt;</);
});

test('an archived hit is dim with its chip, and none carries Un-archive', () => {
  const s = listed([conv('f', { title: 'Old face', archived: 'face' }), conv('h', { title: 'Old host', archived: 'host', updatedAt: NOW - 9 * MIN }), conv('n', { title: 'Old new', updatedAt: NOW - 20 * MIN })], { conversation: 'z' });
  const h = renderSide(searched(s, 'old'), NOW);
  assert.match(h, /<a class="conv-hit archived" href="#\/history\/f"><span class="row-top"><span class="row-title">Old face<\/span><span class="chip grey">Archived<\/span>/);
  assert.match(h, /<a class="conv-hit archived" href="#\/history\/h"/);
  assert.match(h, /<a class="conv-hit" href="#\/history\/n"/);
  assert.equal(count(h, /Archived</g), 2);
  assert.doesNotMatch(h, /data-action="unarchive"|class="btn-sm"/);
});

test("each state's line, word for word", () => {
  const s = listed([conv('a', { title: 'Alpha' }), ...Array.from({ length: 21 }, (_, i) => conv(`k${i}`, { title: `Kilo ${i}` }))], { conversation: 'z' });
  const searching = renderSide(searched(s, 'zz'), NOW);
  assert.match(searching, /<div class="conv-results"><div class="conv-results-state">Searching every conversation…<\/div><div class="sk"><\/div><div class="sk"><\/div><div class="sk"><\/div><\/div>/);
  assert.match(renderSide(searched(s, 'zz', { items: [], hasMore: false }), NOW), /<div class="conv-results"><div class="conv-results-state">No matching conversations<\/div><\/div>/);
  assert.match(renderSide(searched(s, 'zz', 'failed'), NOW), /<div class="conv-results"><div class="conv-results-state">Could not search inside conversations<\/div><\/div>/);
  const kept = renderSide(searched(s, 'alpha', 'failed'), NOW);
  assert.match(kept, /conv-results-count">1 conversation<[\s\S]*href="#\/history\/a"[\s\S]*<div class="conv-results-state">Could not search inside conversations<\/div><\/div><\/div><\/aside>$/);
  const cut = renderSide(searched(s, 'kilo'), NOW);
  assert.equal(count(cut, /class="conv-hit[ "]/g), 20);
  assert.match(cut, /conv-results-count">20 conversations<[\s\S]*<div class="conv-results-state">Showing the first 20\. Narrow your search\.<\/div><\/div><\/div><\/aside>$/);
  assert.match(renderSide(searched(s, 'alpha', { items: [], hasMore: true }), NOW), /Showing the first 20\. Narrow your search\.<\/div><\/div><\/div><\/aside>$/);
  assert.doesNotMatch(renderSide(searched(s, 'alpha', { items: [], hasMore: false }), NOW), /conv-results-state/);
});

// masking on screen (plan 5 Task 2): every excerpt is masked whoever spoke, with no eye
const SK = 'sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4';
const SK_MASKED = 'sk-proj-' + '*'.repeat(SK.length - 8);

test("a hit's title and snippet are masked, and the match still marks the same characters", () => {
  const s = listed([conv('a', { title: `deploy ${SK} <b>` }), conv('b', { title: 'plain' })], { conversation: 'z' });
  const byTitle = renderSide(searched(s, 'deploy'), NOW);
  assert.ok(byTitle.includes(`row-title">deploy ${SK_MASKED} &lt;b&gt;<`));
  const snippet = `x ${SK} the zz end`;
  const at = snippet.indexOf('zz');
  const h = renderSide(searched(s, 'zz', { items: [{ sessionId: 'b', snippet, match: [at, at + 2] }], hasMore: false }), NOW);
  assert.ok(h.includes(`<b class="conv-hit-channel">No channel</b> x ${SK_MASKED} the <mark>zz</mark> end</span>`));
  const over = renderSide(searched(s, 'zz', { items: [{ sessionId: 'b', snippet, match: [2, 2 + SK.length] }], hasMore: false }), NOW);
  assert.ok(over.includes(`x <mark>${SK_MASKED}</mark> the zz end`));
  for (const x of [byTitle, h, over]) assert.doesNotMatch(x, /aB3dE6fG9h/);
});

test('the narrow window disclosure exposes its state and controls the search and the rows', () => {
  const s = listed([conv('a')]);
  assert.equal(s.listOpen, false);
  const closed = renderSide(s, NOW);
  assert.match(closed, /<aside class="list" data-list-open="false" aria-label="Messages">/);
  assert.match(closed, /id="list-toggle" class="list-toggle" data-action="toggleList" aria-expanded="false" aria-controls="conversation-list-body" aria-label="Show conversations"/);
  assert.match(closed, /id="conversation-list-body">[\s\S]*id="cq"[\s\S]*class="rail-rows"/);
  const opened = R.toggleList(s);
  assert.match(renderSide(opened, NOW), /aria-label="Hide conversations"/);
  assert.equal(R.nav(opened, opened.route).listOpen, true, 'the duplicate hashchange leaves the disclosure alone');
  assert.equal(R.nav(opened, { screen: 'history', id: null }).listOpen, false, 'a row followed folds it');
});
