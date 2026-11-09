// The first level of the rail on the host's facts (spec 2026-10-19 §7 "Rail"): Messages with its badge, Markets, Trade (spec
// 2026-10-22 §6.4) and Discover, Account at the foot; no phone or mail. The second level is the side panel (side.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderNav, senderName } from '../../client/js/render/rail.js';
import { renderSide } from '../../client/js/render/side.js';
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
  // `open` is the conversation /data/tasks names, on Messages
  return R.nav(open ? R.tasksLoaded(s, { conversation: open, tasks: [], at: NOW }) : s, { screen: 'messages', id: null });
};

test('the first level: Messages, Markets and Account on the face; no phone or mail', () => {
  const h = renderNav(listed([conv('a')]));
  assert.match(h, /href="#\/messages"[^>]*>[\s\S]*?Messages/);
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
  assert.equal(renderSide(R.nav(base, { screen: 'trade', id: null }), NOW), '', 'no side panel beside Trade');
  assert.match(renderNav({ ...base, railCollapsed: true }), /title="Trade"/);
});

test('the Messages badge counts the tasks waiting on you: a worker whose gate came, a failed one; never a session that is no task', () => {
  const task = (id, over = {}) => ({ id, title: id, origin: 'web', state: 'running', group: 'running', steps: [], startedAt: NOW, lastEventAt: NOW, lastSeq: 1, ...over });
  let s = R.tasksLoaded(listed([conv('a'), conv('b'), conv('c'), conv('x')], 'a'), { conversation: 'a', tasks: [task('b'), task('c'), task('f', { state: 'failed', group: 'you' }), task('r')], at: NOW });
  s = R.hostGate(s, { convId: 'b', message: gate });
  s = R.hostGate(s, { convId: 'c', message: { ...gate, id: 'ev-2', data: { eventId: 'ev-2', sessionId: 'c' } } });
  s = R.hostGate(s, { convId: 'c', message: { ...gate, id: 'ev-3', data: { eventId: 'ev-3', sessionId: 'c' } } });
  s = R.hostGate(s, { convId: 'x', message: { ...gate, id: 'ev-4', data: { eventId: 'ev-4', sessionId: 'x' } } });
  assert.match(renderNav(s), /nav-badge">3</, 'b and c (a line each), the failed f; x is no task');
  const settled = R.hostGateGone(R.hostGateGone(R.hostGateGone(s, { eventId: 'ev-1', outcome: 'closed' }), { eventId: 'ev-2', outcome: 'approved' }), { eventId: 'ev-3', outcome: 'closed' });
  assert.match(renderNav(settled), /nav-badge">1</, 'the failed task still waits on you');
  assert.doesNotMatch(renderNav(listed([conv('a')])), /nav-badge/);
});

test('collapsed, the first level is a strip of icons with the names as titles', () => {
  const h = renderNav(listed([conv('a')], 'a', { railCollapsed: true }));
  assert.match(h, /class="rail mini"/);
  assert.match(h, /title="Markets"/);
  assert.match(h, /aria-label="Expand navigation"/);
});

test('Markets links #/markets and is current on the Markets screen and on a market page', () => {
  const list = renderNav(R.nav(listed([conv('a')]), { screen: 'markets', id: null }));
  assert.match(list, /class="nav-item current" aria-current="page" href="#\/markets"/);
  assert.doesNotMatch(list, /class="nav-item current"[^>]*href="#\/messages/);
  const page = renderNav(R.nav(listed([conv('a')]), { screen: 'markets', id: 'us:AAPL' }));
  assert.match(page, /class="nav-item current" aria-current="page" href="#\/markets"/);
  assert.equal(renderSide(R.nav(listed([conv('a')]), { screen: 'markets', id: null }), NOW), '', 'the side panel belongs to Messages');
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

test('the Messages key goes to Messages, the conversation, never to a session by its id', () => {
  const s = R.nav(listed([conv('z', { archived: 'face', updatedAt: NOW }), conv('a')], 'a'), { screen: 'markets', id: null });
  const h = renderNav(s);
  assert.match(h, /class="nav-item" href="#\/messages"/);
  assert.doesNotMatch(h, /href="#\/messages\/[az]"/);
});

test('Discover is in the first level, current on Discover, on a plugin page and on a module page', () => {
  const base = listed([conv('a')]);
  assert.match(renderNav(base), /class="nav-item" href="#\/discover"[^>]*>[\s\S]*?Discover/);
  for (const route of [{ screen: 'discover', id: null }, { screen: 'plugin', id: 'bot:buffett' }, { screen: 'module', id: 'theme' }]) {
    assert.match(renderNav(R.nav(base, route)), /class="nav-item current" aria-current="page" href="#\/discover"/, route.screen);
  }
  assert.equal(renderSide(R.nav(base, { screen: 'discover', id: null }), NOW), '', 'no side panel beside Discover');
});

test('Messages is current on a task, history or strategy page', () => {
  const base = R.hostList(listed([conv('a'), conv('t')], 'a'), { conversations: [conv('a'), conv('t')], channels: [{ workspaceId: 'w0', name: 'workbench', isRoot: true }, { workspaceId: 'w1', name: 'alpha', isRoot: false }] });
  for (const route of [{ screen: 'task', id: 't' }, { screen: 'history', id: null }, { screen: 'history', id: 't' }, { screen: 'strategy', id: 'alpha' }]) {
    const h = renderNav({ ...base, route });
    assert.match(h, /<a class="nav-item current" aria-current="page" href="#\/messages">/, `${route.screen} ${route.id}`);
    assert.equal(count(h, /aria-current="page"/g), 1, 'nothing else is current');
  }
});

test("a sender's name: You, Gravit, a bot's display name from the list, else its id", () => {
  const s = listed([conv('a')]);
  assert.equal(senderName('you', s), 'You');
  assert.equal(senderName('gravit', s), 'Gravit');
  assert.equal(senderName('buffett', s), 'Buffett Type');
  assert.equal(senderName('ghost', s), 'ghost');
});
