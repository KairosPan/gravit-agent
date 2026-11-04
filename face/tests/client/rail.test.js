// The two-level rail on the host's facts (spec 2026-10-19 §7 "Rail", "List"): Messages with its badge, Markets, Trade (spec
// 2026-10-22 §6.4) and Discover, Account at the foot; no phone or mail; rows from the conversations the list gave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avatar, cluster, groupMark } from '../../client/js/render/avatars.js';
import { renderRail, renderNav, renderList, previewOf, senderName } from '../../client/js/render/rail.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { MIN } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 19, 14, 7).getTime();
const count = (h, re) => (h.match(re) ?? []).length;
// the stand-in Account's answers (tests/fixtures/account/), parsed afresh for every call
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, updatedAt: NOW - 5 * MIN, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const gate = { id: 'ev-1', seq: 1.5, at: NOW, from: 'gravit', kind: 'card', text: 'Your call', data: { eventId: 'ev-1', sessionId: 'a' } };
const bots = [{ id: 'buffett', name: 'Buffett Type' }];
const listed = (convs, open = convs[0]?.id ?? null, extra = {}) => {
  let s = R.hostList(emptyState(), { conversations: convs, channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true }], bots });
  s = { ...s, ...extra };
  return R.nav(s, { screen: 'messages', id: open });
};

test('the first level: Messages, Markets and Account on the face; no phone or mail', () => {
  const h = renderNav(listed([conv('a')]));
  assert.match(h, /href="#\/messages\/a"[^>]*>[\s\S]*?Messages/);
  assert.match(h, /class="nav-item" href="#\/markets"[^>]*>[\s\S]*?Markets/);
  assert.doesNotMatch(h, /href="\/market"/);
  assert.match(h, /class="account" href="#\/account\/portfolio"/);
  assert.doesNotMatch(h, /href="\/account"/);
  assert.match(h, /account-title">Account</);
  assert.match(h, /data-action="openSettings"/, 'the theme lives behind a Settings key at the foot');
  for (const gone of ['phoneCall', '#/mail', 'nav-badge', 'Guard']) assert.doesNotMatch(h, new RegExp(gone), gone);
});

test('Trade is in the first level between Markets and Discover, current on the Trade screen and on a market opened there', () => {
  const base = listed([conv('a')]);
  const h = renderNav(base);
  const keys = [...h.matchAll(/class="nav-item[^"]*"(?: aria-current="page")? href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(keys.slice(1), ['#/markets', '#/trade', '#/discover'], 'Messages, then Markets, Trade, Discover');
  assert.match(h, /<a class="nav-item" href="#\/trade"><svg[^>]*>.*?<\/svg><span class="nav-label">Trade<\/span><\/a>/);
  for (const id of [null, 'coin:BTC']) {
    const on = renderNav(R.nav(base, { screen: 'trade', id }));
    assert.match(on, /<a class="nav-item current" aria-current="page" href="#\/trade">/, String(id));
    assert.doesNotMatch(on, /class="nav-item current" aria-current="page" href="#\/markets"/);
  }
  assert.equal(renderList(R.nav(base, { screen: 'trade', id: null }), NOW), '', 'no conversation list beside Trade');
  assert.match(renderNav({ ...base, railCollapsed: true }), /title="Trade"/);
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

test("the conversation on screen previews its own window's last spoken line, not the one-message page read before it loaded", () => {
  const messages = [
    { id: 'e1', seq: 1, at: NOW, from: 'you', kind: 'text', text: 'Which bed?', data: {} },
    { id: 'e2', seq: 2, at: NOW, from: 'gravit', kind: 'text', text: 'Breadth is still positive.', data: {} },
  ];
  const open = listed([conv('a', { loaded: true, preview: 'Both pivots are technically valid.', messages }), conv('b', { preview: 'Older words.' })], 'a');
  assert.equal(previewOf(open.conversations[0], open), 'Breadth is still positive.');
  assert.equal(previewOf(open.conversations[1], open), 'Older words.', 'a row not on screen keeps its read preview');
});

test("a row's fallback preview is the last SPOKEN line: a context row (a runtime snapshot) or a tool row never stands in", () => {
  const c = conv('c', { messages: [
    { id: 'e1', seq: 1, at: NOW, from: 'you', kind: 'text', text: 'Which bed?', data: {} },
    { id: 'tc1', seq: 2, at: NOW, from: 'gravit', kind: 'tool', text: 'bash', data: { callId: 'c1' } },
    { id: 'e3', seq: 3, at: NOW, from: 'system', kind: 'text', text: 'Current runtime context…', data: { source: 'runtime-context' } },
  ] });
  assert.equal(previewOf(c), 'Which bed?');
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

test('Markets links #/markets and is current on the Markets screen and on a market page', () => {
  const list = renderNav(R.nav(listed([conv('a')]), { screen: 'markets', id: null }));
  assert.match(list, /class="nav-item current" aria-current="page" href="#\/markets"/);
  assert.doesNotMatch(list, /class="nav-item current"[^>]*href="#\/messages/);
  const page = renderNav(R.nav(listed([conv('a')]), { screen: 'markets', id: 'us:AAPL' }));
  assert.match(page, /class="nav-item current" aria-current="page" href="#\/markets"/);
  assert.equal(renderList(R.nav(listed([conv('a')]), { screen: 'markets', id: null }), NOW), '', 'the conversation list belongs to Messages');
});

test('Account links #/account/portfolio, is current on Account, and carries the net worth once the account has answered', () => {
  const on = R.nav(listed([conv('a')]), { screen: 'account', tab: 'venues' });
  assert.match(renderNav(on), /class="account current" aria-current="page" href="#\/account\/portfolio"/);
  assert.doesNotMatch(renderNav(on), /account-line/, 'no number before the account answers');
  const read = R.accountLoaded(on, { data: fx('account'), at: NOW });
  assert.match(renderNav(read), /<span class="account-title">Account<\/span><span class="account-line">\$29,138\.10<\/span>/);
  const unrecognised = R.accountLoaded(on, { data: { ok: true, available: false, reason: 'no APCA keys in the environment' }, at: NOW });
  assert.doesNotMatch(renderNav(unrecognised), /account-line/);
  assert.doesNotMatch(renderNav(R.nav(read, { screen: 'markets', id: null })), /class="account current"/);
});

test('rail: the worth line is the lead figure with Paper when paper leads', () => {
  const on = R.nav(listed([conv('a')]), { screen: 'markets', id: null });
  const page = fx('account');
  // real money leads while there is any: the page's total, the paper book beside it on the screen, not here
  const real = R.paperLoaded(R.accountLoaded(on, { data: page, at: NOW }), { data: fx('holdings-paper'), at: NOW });
  assert.match(renderNav(real), /<span class="account-line">\$29,138\.10<\/span>/);
  // no real money and a paper book with money in it: the paper total, named so
  const paper = R.paperLoaded(R.accountLoaded(on, { data: { ...page, totalUsd: 0 }, at: NOW }), { data: fx('holdings-paper'), at: NOW });
  assert.match(renderNav(paper), /<span class="account-title">Account<\/span><span class="account-line">\$25,400\.00 · Paper<\/span>/);
  // a total on a body that is not the page is never drawn
  assert.doesNotMatch(renderNav(R.accountLoaded(on, { data: { ok: true, totalUsd: 5 }, at: NOW })), /account-line/);
  // a refusal after a good read keeps the last figure, as the screen does
  assert.match(renderNav(R.accountFailed(paper, { at: NOW, message: 'locked' })), /\$25,400\.00 · Paper/);
});

test('rail: the Account key carries the count of the cards waiting, as Messages carries its gates; none when none wait', () => {
  const on = R.nav(listed([conv('a')]), { screen: 'markets', id: null });
  const page = fx('account');   // one card waiting, Claude Code's
  assert.match(renderNav(R.accountLoaded(on, { data: page, at: NOW })),
    /<span class="account-body"><span class="account-title">Account<\/span><span class="account-line">\$29,138\.10<\/span><\/span><span class="nav-badge">1<\/span><\/a>/);
  const two = { ...page, cards: [page.cards[0], { ...page.cards[0], id: 'card-0002', agent: '0xb0b', agentName: 'Scout' }] };
  assert.match(renderNav(R.accountLoaded(on, { data: two, at: NOW })), /<span class="nav-badge">2<\/span><\/a>/, 'every card of every agent');
  assert.equal(count(renderNav(R.accountLoaded(on, { data: two, at: NOW })), /class="nav-badge"/g), 1, 'the Messages key has no gate waiting');
  for (const none of [{ ...page, cards: [] }, { ok: true, cards: page.cards }]) {
    assert.doesNotMatch(renderNav(R.accountLoaded(on, { data: none, at: NOW })), /nav-badge/, 'nothing waiting, or a page the face does not recognise');
  }
  assert.doesNotMatch(renderNav(on), /nav-badge/, 'nothing read');
  // collapsed, the badge stays on the key
  assert.match(renderNav(R.toggleRail(R.accountLoaded(on, { data: page, at: NOW }))), /class="account"[^>]*title="Account">[\s\S]*<span class="nav-badge">1<\/span><\/a>/);
});

test('the Messages key never points at an archived conversation', () => {
  const s = R.nav(listed([conv('z', { archived: 'face', updatedAt: NOW }), conv('a')], 'a'), { screen: 'markets', id: null });
  const h = renderNav({ ...s, lastConv: null });
  assert.match(h, /href="#\/messages\/a"/);
  assert.doesNotMatch(h, /href="#\/messages\/z"/);
});

test('a header per group with its collapse key and its channel link', () => {
  const s = listed([conv('a', { channel: { workspaceId: 'w0', name: 'workbench' } }), conv('b', { archived: 'face' })], 'a');
  const h = renderList(s, NOW);
  assert.match(h, /<div class="grp-head"><button type="button" class="grp-key" data-action="toggleGroup" data-key="w0" aria-expanded="true" aria-label="Collapse workbench">/);
  assert.match(h, /<a class="grp-name" href="#\/channel\/w0">workbench<\/a>/);
  assert.match(h, /data-key="__archived" aria-expanded="false" aria-label="Expand Archived"/);
  assert.doesNotMatch(h, /data-id="b"/, 'the archived row is folded away');
  assert.match(h, /data-id="a"/);
});

test('group and channel names are escaped', () => {
  const s = R.nav(R.hostList(emptyState(), { conversations: [conv('a')], channels: [{ workspaceId: 'w1', name: '<b>x</b>', title: '<b>x</b>', isRoot: true }], bots: [{ id: 'evil', name: '<i>bot</i>' }] }), { screen: 'messages', id: 'a' });
  const t = R.hostList(s, { conversations: [conv('a'), conv('h', { kind: 'bot', preset: 'evil', members: ['evil'] })] });
  const h = renderList(t, NOW);
  assert.doesNotMatch(h, /<b>x<\/b>|<i>bot<\/i>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/); assert.match(h, /&lt;i&gt;bot&lt;\/i&gt;/);
});

test('on a channel page the list stays beside it, Messages is current and the channel is marked', () => {
  const s = R.nav(listed([conv('a', { channel: { workspaceId: 'w0', name: 'workbench' } })], 'a'), { screen: 'channel', id: 'w0' });
  const h = renderRail(s, NOW);
  assert.match(h, /class="nav-item current" aria-current="page" href="#\/messages\/a"/);
  assert.match(h, /class="list"/);
  assert.match(h, /<a class="grp-name current" aria-current="page" href="#\/channel\/w0">/);
});

test('Discover is in the first level, current on Discover, on a plugin page and on a module page', () => {
  const base = listed([conv('a')]);
  assert.match(renderNav(base), /class="nav-item" href="#\/discover"[^>]*>[\s\S]*?Discover/);
  for (const route of [{ screen: 'discover', id: null }, { screen: 'plugin', id: 'bot:buffett' }, { screen: 'module', id: 'theme' }]) {
    assert.match(renderNav(R.nav(base, route)), /class="nav-item current" aria-current="page" href="#\/discover"/, route.screen);
  }
  assert.equal(renderList(R.nav(base, { screen: 'discover', id: null }), NOW), '', 'no conversation list beside Discover');
});

// the list's search (plan 2 of the dsh UI port, Task 3): the box under the head, the results in place of the groups
const searched = (s, q, answer) => {
  let t = R.setSearchQuery(s, q);
  if (answer === 'failed') t = R.searchFailed(t, { query: q });
  else if (answer) t = R.searchContent(t, { query: q, ...answer });
  return t;
};

test('the box sits under the list head with its placeholder and key hint', () => {
  const s = listed([conv('a')]);
  const h = renderList(s, NOW);
  assert.match(h, /<\/div><div class="conv-search"><svg[^>]*>[\s\S]*?<\/svg><input id="cq" type="search" autocomplete="off" placeholder="Search conversations" aria-label="Search conversations" data-action="convQuery" value=""><kbd class="conv-search-key">⌥⌘K<\/kbd><\/div><div class="rail-rows">/);
  assert.ok(h.indexOf('class="list-head"') < h.indexOf('class="conv-search"'));
  assert.match(renderList(s, NOW, { mac: false }), /<kbd class="conv-search-key">Ctrl\+Alt\+K<\/kbd>/, 'off a Mac');
  assert.match(renderList(searched(s, 'T "a'), NOW), /data-action="convQuery" value="T &quot;a"/, "the box's value is the store's");
  assert.match(renderList(R.nav(listed([]), { screen: 'messages', id: null }), NOW), /class="conv-search"/, 'there with no conversation');
});

test('a query replaces the groups with the results and their count', () => {
  const s = R.startDraft(listed([conv('a', { title: 'Moutai notes', channel: { workspaceId: 'w0', name: 'workbench' } }), conv('b', { title: 'Other' }), conv('c', { title: 'moutai again', updatedAt: NOW - 1 * MIN })], 'a'), { now: NOW });
  const h = renderList(searched(s, 'moutai'), NOW);
  assert.doesNotMatch(h, /class="rail-rows"|class="grp-head"|draft/, 'no groups and no draft row while a query stands');
  assert.match(h, /<div class="conv-results"><div class="conv-results-count">2 conversations<\/div>/);
  const ids = [...h.matchAll(/class="conv-hit[^"]*" href="#\/messages\/(\w+)" data-action="open" data-id="(\w+)"/g)].map(m => m[1] + m[2]);
  assert.deepEqual(ids, ['cc', 'aa'], 'newest first, each a link that opens it');
  assert.match(h, /<span class="row-top"><span class="row-title">moutai again<\/span><span class="row-time">[^<]+<\/span><\/span><span class="conv-hit-line"><b class="conv-hit-channel">No channel<\/b>/);
  assert.match(h, /<b class="conv-hit-channel">workbench<\/b>/);
  assert.match(renderList(searched(s, 'other'), NOW), /conv-results-count">1 conversation</);
  assert.equal(s.collapsed, R.setSearchQuery(s, 'x').collapsed, "the groups' collapse preferences are untouched");
  // a blank query is no query: the groups as they were
  assert.equal(renderList(searched(s, '   '), NOW), renderList(s, NOW).replace('value=""', 'value="   "'));
});

test("the snippet's match is marked, and every host word is escaped", () => {
  const s = listed([conv('a', { title: '<b>x</b>', channel: { workspaceId: 'w1', name: '<i>c</i>' } }), conv('b', { title: 'plain' })]);
  const withCh = R.hostList(s, { conversations: s.conversations, channels: [{ workspaceId: 'w1', name: '<i>c</i>', isRoot: false }] });
  const h = renderList(searched(withCh, 'zz', { items: [{ sessionId: 'b', snippet: 'say <zz> & go', match: [4, 8] }], hasMore: false }), NOW);
  assert.match(h, /<span class="conv-hit-line"><b class="conv-hit-channel">No channel<\/b> say <mark>&lt;zz&gt;<\/mark> &amp; go<\/span>/);
  const t = renderList(searched(withCh, 'x'), NOW);
  assert.doesNotMatch(t, /<b>x<\/b>|<i>c<\/i>/);
  assert.match(t, /row-title">&lt;b&gt;x&lt;\/b&gt;</);
  assert.match(t, /conv-hit-channel">&lt;i&gt;c&lt;\/i&gt;</);
});

test('an archived hit is dim with its chip, and a face-archived one carries Un-archive beside the link', () => {
  const s = listed([conv('f', { title: 'Old face', archived: 'face' }), conv('h', { title: 'Old host', archived: 'host', updatedAt: NOW - 9 * MIN }), conv('n', { title: 'Old new', updatedAt: NOW - 20 * MIN })]);
  const h = renderList(searched(s, 'old'), NOW);
  assert.match(h, /<a class="conv-hit archived" href="#\/messages\/f" data-action="open" data-id="f"><span class="row-top"><span class="row-title">Old face<\/span><span class="chip grey">Archived<\/span>/);
  assert.match(h, /<a class="conv-hit archived" href="#\/messages\/h"[\s\S]*?<span class="chip grey">Archived<\/span>/);
  assert.match(h, /<a class="conv-hit" href="#\/messages\/n"/);
  assert.equal(count(h, /Archived</g), 2);
  assert.match(h, /data-id="f">[\s\S]*?<\/a><button type="button" class="btn-sm" data-action="unarchive" data-conv="f">Un-archive<\/button>/, 'a sibling after the link');
  assert.equal(count(h, /data-action="unarchive"/g), 1, "the host's archive cannot be undone here");
  for (const a of h.match(/<a [\s\S]*?<\/a>/g)) assert.doesNotMatch(a, /<button/, 'never inside the link');
});

test("each state's line, word for word", () => {
  const s = listed([conv('a', { title: 'Alpha' }), ...Array.from({ length: 21 }, (_, i) => conv(`k${i}`, { title: `Kilo ${i}` }))]);
  const searching = renderList(searched(s, 'zz'), NOW);
  assert.match(searching, /<div class="conv-results"><div class="conv-results-state">Searching every conversation…<\/div><div class="sk"><\/div><div class="sk"><\/div><div class="sk"><\/div><\/div>/);
  assert.doesNotMatch(searching, /conv-results-count/);
  assert.match(renderList(searched(s, 'zz', { items: [], hasMore: false }), NOW), /<div class="conv-results"><div class="conv-results-state">No matching conversations<\/div><\/div>/);
  assert.match(renderList(searched(s, 'zz', 'failed'), NOW), /<div class="conv-results"><div class="conv-results-state">Could not search inside conversations<\/div><\/div>/);
  // a failed content search keeps the title matches, the muted line after them
  const kept = renderList(searched(s, 'alpha', 'failed'), NOW);
  assert.match(kept, /conv-results-count">1 conversation<[\s\S]*data-id="a"[\s\S]*<div class="conv-results-state">Could not search inside conversations<\/div><\/div><\/aside>$/);
  // more than twenty: by the merge's cut, and by the wire's hasMore
  const cut = renderList(searched(s, 'kilo'), NOW);
  assert.equal(count(cut, /class="conv-hit[ "]/g), 20);
  assert.match(cut, /conv-results-count">20 conversations<[\s\S]*<div class="conv-results-state">Showing the first 20\. Narrow your search\.<\/div><\/div><\/aside>$/);
  assert.match(renderList(searched(s, 'alpha', { items: [], hasMore: true }), NOW), /<div class="conv-results-state">Showing the first 20\. Narrow your search\.<\/div><\/div><\/aside>$/);
  assert.doesNotMatch(renderList(searched(s, 'alpha', { items: [], hasMore: false }), NOW), /conv-results-state/, 'results alone say nothing more');
});

test('a pinned row carries the pin glyph before its time', () => {
  const s = listed([conv('a'), conv('b')], 'a', { pinned: ['b'] });
  const h = renderList(s, NOW);
  assert.equal(count(h, /class="row-pin"/g), 1);
  assert.match(h, /href="#\/messages\/b"[\s\S]*?<span class="row-pin"><svg[^>]*fill="currentColor"[\s\S]*?<\/span><span class="row-time">/);
});

test("the pin key sits beside the row's link, never inside it, and an archived row has none", () => {
  const s = listed([conv('a'), conv('b')], 'a', { pinned: ['b'] });
  const h = renderList(s, NOW);
  assert.equal(count(h, /<div class="row-wrap">/g), 2);
  assert.match(h, /<\/a><button type="button" class="pin-key" data-action="pin" data-conv="a" aria-label="Pin" id="pin-a">/);
  assert.match(h, /<\/a><button type="button" class="pin-key" data-action="unpin" data-conv="b" aria-label="Unpin" id="pin-b">/);
  assert.doesNotMatch(h, /<a[^>]*class="row[^"]*"[^>]*>(?:(?!<\/a>)[\s\S])*pin-key/, 'the key is not inside the link');
  const old = renderList(listed([conv('a'), conv('z', { archived: 'face' })], 'z', { pinned: ['z'] }), NOW);
  const z = old.match(/<div class="row-wrap">(?:(?!<div class="row-wrap">)[\s\S])*?data-id="z"[\s\S]*?<\/div>/);
  assert.ok(z, "the archived row z is drawn (it is the current one, so its collapsed group shows it)");
  assert.doesNotMatch(z[0], /pin-key/);
});

test('the key is reachable by Tab: a button with an accessible name', () => {
  const h = renderList(listed([conv('a')]), NOW);
  assert.match(h, /<button type="button" class="pin-key"[^>]*aria-label="Pin"/);
  assert.doesNotMatch(h, /pin-key[^>]*tabindex="-1"/);
});

test("the row's pin key carries one stable id through pin and unpin", () => {
  const h = renderList(listed([conv('a'), conv('b')], 'a', { pinned: ['b'] }), NOW);
  assert.match(h, /data-action="pin" data-conv="a" aria-label="Pin" id="pin-a">/);
  assert.match(h, /data-action="unpin" data-conv="b" aria-label="Unpin" id="pin-b">/);
});

test('an attachment-only last message previews as its names', () => {
  const files = [{ type: 'image', attachmentId: 'a1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'chart.png' }, { type: 'file', attachmentId: 'a2', name: 'q3.csv', bytes: 2 }];
  const c = conv('c', { messages: [
    { id: 'e1', seq: 1, at: NOW, from: 'gravit', kind: 'text', text: 'Send me the files.', data: {} },
    { id: 'e2', seq: 2, at: NOW, from: 'you', kind: 'text', text: '', data: { attachments: files } },
  ] });
  assert.equal(previewOf(c), 'chart.png, q3.csv');
});

// masking on screen (plan 5 Task 2): every excerpt is masked whoever spoke (the operator's ruling), with no eye
const SK = 'sk-proj-aB3dE6fG9hJ2kL5mN8pQ1rS4';
const SK_MASKED = 'sk-proj-' + '*'.repeat(SK.length - 8);

test('the preview line is masked, with no eye', () => {
  const said = conv('a', { messages: [{ id: 'e1', seq: 1, at: NOW, from: 'gravit', kind: 'text', text: `saved ${SK}`, data: {} }] });
  const read = conv('b', { preview: `mine ${SK} <b>` });
  const h = renderList(listed([said, read], 'a'), NOW);
  assert.ok(h.includes(`row-preview">saved ${SK_MASKED}<`));
  assert.ok(h.includes(`row-preview">mine ${SK_MASKED} &lt;b&gt;<`));
  assert.doesNotMatch(h, /aB3dE6fG9h|secret-eye|class="secret/);
});

test('a snippet holding a key is masked and its match still marks the same characters', () => {
  const s = listed([conv('a', { title: 'plain' })]);
  const snippet = `x ${SK} the zz end`;
  const at = snippet.indexOf('zz');
  const h = renderList(searched(s, 'zz', { items: [{ sessionId: 'a', snippet, match: [at, at + 2] }], hasMore: false }), NOW);
  assert.ok(h.includes(`<b class="conv-hit-channel">No channel</b> x ${SK_MASKED} the <mark>zz</mark> end</span>`));
  assert.doesNotMatch(h, /aB3dE6fG9h/);
  // a match over the key marks its masked characters
  const over = renderList(searched(s, 'zz', { items: [{ sessionId: 'a', snippet, match: [2, 2 + SK.length] }], hasMore: false }), NOW);
  assert.ok(over.includes(`x <mark>${SK_MASKED}</mark> the zz end`));
});
