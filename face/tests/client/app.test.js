// The app's pure parts on the host: the route, the prefs, the timers, the question batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, toHash } from '../../client/js/router.js';
import { Timers, routeOf, settle, initialState, prefsOf, makeStore, answersFrom, gravitMarkdown, getJsonVia, PREFS_KEY } from '../../client/js/app.js';
import { emptyState } from '../../client/js/data/empty.js';
import { withMiniDocument } from './helpers/mini-dom.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; };

test('parseHash and toHash round-trip; Messages and Markets route, every other screen folds to Messages', () => {
  assert.deepEqual(parseHash('#/messages/s1'), { screen: 'messages', id: 's1' });
  assert.equal(toHash({ screen: 'messages', id: 's1' }), '#/messages/s1');
  assert.deepEqual(routeOf('#/messages/s1'), { screen: 'messages', id: 's1' });
  assert.deepEqual(routeOf('#/discover'), { screen: 'discover', id: null });
  assert.deepEqual(routeOf('#/discover/agents'), { screen: 'discover', id: 'agents' });
  assert.deepEqual(routeOf('#/discover/create'), { screen: 'discover', id: 'create' });
  assert.deepEqual(routeOf('#/plugin/agent:gravit'), { screen: 'plugin', id: 'agent:gravit' });
  assert.deepEqual(routeOf('#/mail'), { screen: 'messages', id: null }, 'Mail folds to Messages');
  assert.deepEqual(routeOf('#/markets/us:AAPL'), { screen: 'markets', id: 'us:AAPL' });
  assert.deepEqual(routeOf('#/markets'), { screen: 'markets', id: null });
  assert.deepEqual(routeOf(''), { screen: 'messages', id: null });
  // a crypto id carries its slash: the id is everything after #/markets/, written back raw
  assert.equal(parseHash('#/markets/crypto:BTC/USD').id, 'crypto:BTC/USD');
  assert.equal(toHash(parseHash('#/markets/crypto:BTC/USD')), '#/markets/crypto:BTC/USD');
  assert.equal(parseHash('#/markets/crypto:BTC%2FUSD').id, 'crypto:BTC/USD', 'an encoded link reads the same');
  assert.equal(parseHash('#/markets/').id, null);
  // Trade, and a market to open on it: an Account key, everything after #/trade/, decoded, written back raw
  assert.deepEqual(parseHash('#/trade'), { screen: 'trade', id: null });
  assert.deepEqual(parseHash('#/trade/'), { screen: 'trade', id: null });
  assert.equal(toHash({ screen: 'trade', id: null }), '#/trade');
  assert.deepEqual(parseHash('#/trade/coin:BTC'), { screen: 'trade', id: 'coin:BTC' });
  assert.equal(parseHash('#/trade/event:predict:SI-FEDCUT-DEC').id, 'event:predict:SI-FEDCUT-DEC');
  assert.equal(parseHash('#/trade/pm%3A0xab').id, 'pm:0xab', 'an encoded link reads the same');
  assert.equal(toHash(parseHash('#/trade/stock:NVDA')), '#/trade/stock:NVDA');
  // a channel page and a plugin page take everything after the screen, decoded, as a market does
  assert.deepEqual(parseHash('#/channel/ws-1'), { screen: 'channel', id: 'ws-1' });
  assert.equal(toHash({ screen: 'channel', id: 'ws-1' }), '#/channel/ws-1');
  assert.deepEqual(routeOf('#/channel/ws-1'), { screen: 'channel', id: 'ws-1' });
  assert.equal(parseHash('#/plugin/skill%3Arules').id, 'skill:rules');
  assert.equal(parseHash('#/plugin/mcp:alpaca-kit').id, 'mcp:alpaca-kit');
  assert.deepEqual(parseHash('#/account/venues'), { screen: 'account', tab: 'venues' });
  assert.deepEqual(parseHash('#/account/memory'), { screen: 'account', tab: 'portfolio' }, 'Memory is not drawn');
});

test('initialState is the empty state plus the viewer\'s prefs; garbage prefs are ignored', () => {
  const storage = memory();
  storage.setItem(PREFS_KEY, JSON.stringify({ theme: 'black', railCollapsed: true, lastConv: 's9', lastSeen: { s9: 40 }, collapsed: { w1: true, __archived: false }, watch: ['BTC'] }));
  const s = initialState(storage);
  assert.equal(s.theme, 'black'); assert.equal(s.railCollapsed, true); assert.equal(s.lastConv, 's9');
  assert.deepEqual(s.lastSeen, { s9: 40 });
  assert.deepEqual(s.collapsed, { w1: true, __archived: false });
  assert.deepEqual(s.markets.watch, [], 'the stars live under their own keys, never in the prefs');
  assert.deepEqual(s.markets.watchlist, []);
  assert.deepEqual(s.conversations, []);
  storage.setItem(PREFS_KEY, '{"theme":"neon","lastSeen":[1],"collapsed":["w1"],"watch":"x"}');
  const bad = initialState(storage);
  assert.equal(bad.theme, 'system'); assert.deepEqual(bad.lastSeen, {}); assert.deepEqual(bad.collapsed, {});
  storage.setItem(PREFS_KEY, 'not json');
  assert.equal(initialState(storage).theme, 'system');
  assert.equal(initialState(null).theme, 'system');
});

test('the store writes only the prefs, never the conversations, and never loads a saved demo state', () => {
  const storage = memory();
  storage.setItem('gravit-ui.state', JSON.stringify({ v: 5, conversations: [{ id: 'old' }] }));
  const store = makeStore(storage);
  assert.deepEqual(store.get().conversations, []);
  store.dispatch('toggleRail');
  const saved = JSON.parse(storage.getItem(PREFS_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['collapsed', 'lastConv', 'lastSeen', 'railCollapsed', 'theme']);
  assert.equal(saved.railCollapsed, true);
  assert.deepEqual(prefsOf(emptyState()), { theme: 'system', railCollapsed: false, lastConv: null, lastSeen: {}, collapsed: {} });
});

test('settle routes by the hash and says which hash the address bar should show', () => {
  const store = makeStore(null);
  assert.equal(settle(store, '#/messages/zz'), '#/messages', 'a missing conversation folds to none while the list is empty');
  assert.equal(store.get().route.screen, 'messages');
  assert.equal(settle(store, '#/trade'), '#/messages');
  assert.equal(settle(store, '#/markets/us:aapl'), '#/markets/us:AAPL', 'a market id is written in its canonical form');
  assert.deepEqual(store.get().route, { screen: 'markets', id: 'us:AAPL' });
  assert.equal(settle(store, '#/markets/crypto:btc-usd'), '#/markets/crypto:BTC/USD');
  assert.equal(settle(store, '#/markets/garbage'), '#/markets', 'one that is not a market opens Markets');
  assert.equal(settle(store, '#/markets'), null);
});

test('Timers tracks pending timers and clear() cancels them', async () => {
  const t = new Timers();
  let ran = 0;
  t.after(1, () => { ran += 1; });
  t.after(1, () => { ran += 1; });
  t.clear();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ran, 0);
  t.after(1, () => { ran += 1; });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ran, 1);
  assert.equal(t.pending.size, 0);
});

// the app's /data reads: the hosts read the Account's refusal sentence from the body a rejection carries
test('getJsonVia: an answer is its JSON; any other status rejects with the status and, when it parses, the body the face sent', async () => {
  const answer = (status, text) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) });
  const asked = [];
  const getJson = getJsonVia(async path => {
    asked.push(path);
    if (path === '/data/account') return answer(200, '{"ok":true,"venues":[]}');
    if (path === '/data/account/holdings?cost=1') return answer(409, '{"ok":false,"refusal":{"code":"E_ACCOUNT_SETTLING","message":"Venues are still settling."}}');
    return answer(502, '<html>Bad gateway</html>');
  });
  assert.deepEqual(await getJson('/data/account'), { ok: true, venues: [] });
  const refused = await getJson('/data/account/holdings?cost=1').then(() => null, error => error);
  assert.ok(refused instanceof Error);
  assert.equal(refused.message, '/data/account/holdings?cost=1: HTTP 409');
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body, { ok: false, refusal: { code: 'E_ACCOUNT_SETTLING', message: 'Venues are still settling.' } });
  const bare = await getJson('/data/quotes').then(() => null, error => error);
  assert.equal(bare.status, 502);
  assert.equal(Object.hasOwn(bare, 'body'), false, 'a body that is not JSON is none');
  assert.deepEqual(asked, ['/data/account', '/data/account/holdings?cost=1', '/data/quotes']);
});

// a card as the browser hands it to answersFrom: its own inputs, nothing from any other card
const card = inputs => ({ querySelectorAll: sel => (sel === 'input' ? inputs : []) });

test('answersFrom reads the card\'s inputs into the host\'s batch: every question once, custom text when typed', () => {
  const c = card([
    { type: 'radio', name: 'q-ev-2-q1', checked: false, value: 'Yes' }, { type: 'radio', name: 'q-ev-2-q1', checked: true, value: 'No' },
    { type: 'text', name: 'q-ev-2-q1-custom', value: '' },
    { type: 'checkbox', name: 'q-ev-2-q2', checked: true, value: 'AAPL' }, { type: 'checkbox', name: 'q-ev-2-q2', checked: true, value: 'NVDA' },
    { type: 'text', name: 'q-ev-2-q3-custom', value: '  nothing more  ' },
  ]);
  const batch = answersFrom(c, [{ id: 'q1' }, { id: 'q2', multiSelect: true }, { id: 'q3' }], 'ev-2');
  assert.deepEqual(batch, { answers: [{ id: 'q1', selected: ['No'] }, { id: 'q2', selected: ['AAPL', 'NVDA'] }, { id: 'q3', selected: [], custom: 'nothing more' }] });
  assert.deepEqual(answersFrom(c, undefined, 'ev-2'), { answers: [] });
});

test('answersFrom reads only its own card: two pending cards asking the same question id never trade answers', () => {
  const a = card([{ type: 'radio', name: 'q-ev-a-q1', checked: true, value: 'Yes, pin it' }, { type: 'radio', name: 'q-ev-a-q1', checked: false, value: 'Short' }]);
  const b = card([{ type: 'radio', name: 'q-ev-b-q1', checked: false, value: 'Yes, pin it' }, { type: 'radio', name: 'q-ev-b-q1', checked: true, value: 'Short' }]);
  assert.deepEqual(answersFrom(a, [{ id: 'q1' }], 'ev-a'), { answers: [{ id: 'q1', selected: ['Yes, pin it'] }] });
  assert.deepEqual(answersFrom(b, [{ id: 'q1' }], 'ev-b'), { answers: [{ id: 'q1', selected: ['Short'] }] });
});

test("the markdown the app installs for Gravit's words is the rendered HTML, never the word undefined", () => {
  const html = withMiniDocument(() => gravitMarkdown('**NVDA** leads; see [the filing](https://www.sec.gov/x)\n\n| sym | chg |\n|---|---|\n| NVDA | +3.1% |'));
  assert.doesNotMatch(String(html), /undefined/);
  assert.match(html, /^<div class="md">/);
  assert.match(html, /<strong>NVDA<\/strong> leads/);
  assert.match(html, /<a href="https:\/\/www\.sec\.gov\/x" target="_blank" rel="noopener noreferrer">the filing<\/a>/);
  assert.match(html, /<div class="md-tablewrap"><table class="viz-table">/);
});
