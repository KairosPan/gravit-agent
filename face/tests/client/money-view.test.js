// The Money tab's pure rules (plan 4b Task 2): host/money-view.js over the stand-in's page — the Account page's own rules for
// who receives, who moves money, what kinds of move and where to (account/src/portfolio/public/ui/core.js, money.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  servedHere, canMove, canReceive, networksOf, bridgeChainsOf, dollarsOf, receiveRowsOf, receiveNetworkWords, moveSourcesOf,
  moveKindsOf, moveDestinationsOf, moveAssetsOf, pageVenueOf,
} from '../../client/js/host/money-view.js';

const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
// the stand-in's page with its venues changed by id (a function of the venue), and extra venues appended
function page({ venues = {}, extra = [], ...over } = {}) {
  const p = fx('account');
  p.venues = [...p.venues.map(v => (Object.hasOwn(venues, v.id) ? venues[v.id](v) : v)), ...extra];
  return { ...p, ...over };
}
// an exchange that gives deposit addresses
const okx = (over = {}) => ({
  id: 'okx', name: 'OKX', live: true, watchOnly: 'Live · read-only', connector: 'live:exchange:okx',
  liveCan: { withdraw: true, ledgers: ['spot'], transfer: false, swap: false, receive: true, send: false },
  holdings: [{ asset: 'USDT', amount: 900, usd: 900, class: 'stable', note: 'spot' }, { asset: 'USDC', amount: 50, usd: 50, class: 'stable', note: 'spot' }], ...over,
});
// a wallet the owner proved theirs, which sends and bridges
const mine = (over = {}) => ({
  id: 'wallet-mm', name: 'My wallet', live: true, watchOnly: 'Live · read-only', connector: 'live:wallet', address: '0x1111111111111111111111111111111111111111',
  proven: 'signed by its wallet', liveCan: { withdraw: false, ledgers: [], transfer: false, swap: false, receive: true, send: 'wallet' }, holdings: [], ...over,
});

test('the published lists, with the page\'s own fallbacks', () => {
  const p = fx('account');
  assert.deepEqual(networksOf(p), ['Ethereum', 'Optimism', 'BNB Chain', 'Polygon', 'Base', 'Arbitrum']);
  assert.deepEqual(bridgeChainsOf(p), [...networksOf(p), 'Robinhood Chain']);
  assert.ok(dollarsOf(p).includes('USDC.E'));
  const bare = { ...p, networks: [], bridgeChains: undefined, dollars: undefined };
  assert.deepEqual(networksOf(bare), ['Arbitrum', 'Base', 'Ethereum', 'Optimism', 'Polygon', 'BNB Chain'], 'core.js:267');
  assert.deepEqual(bridgeChainsOf(bare), networksOf(bare), 'the chains money moves on');
  assert.ok(dollarsOf(bare).includes('PUSD') && dollarsOf(bare).includes('USDG'), 'core.js:266');
});

test('receiveRowsOf gives a wallet one row over every EVM network and an exchange a row a network', () => {
  const p = page({ extra: [okx(), mine()] });
  const rows = receiveRowsOf(p);
  const wallet = rows.filter(r => r.venue === 'wallet-mm');
  assert.equal(wallet.length, 1, 'one row: its address is the same on every network');
  assert.deepEqual(wallet[0].networks, ['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Ethereum', 'BNB Chain', 'Robinhood Chain'], 'the five first, then the rest');
  assert.deepEqual({ ...wallet[0], networks: undefined }, { id: 'wallet-mm|evm', venue: 'wallet-mm', venueName: 'My wallet', network: 'Base', networks: undefined, asset: 'USDC', assets: ['USDC'], chip: false, kind: 'wallet' });
  assert.equal(receiveNetworkWords(wallet[0]), 'All EVM networks: Base, Arbitrum, Optimism, Polygon, Ethereum, BNB Chain, Robinhood Chain');
  const ex = rows.filter(r => r.venue === 'okx');
  assert.deepEqual(ex.map(r => r.network), ['Ethereum', 'Optimism', 'BNB Chain', 'Polygon', 'Base', 'Arbitrum', 'Robinhood Chain'], 'a row a network');
  assert.deepEqual(ex.map(r => [r.asset, r.chip, r.kind]).at(0), ['USDT', true, 'exchange'], 'the dollar it holds most of');
  assert.deepEqual(ex[0].assets, ['USDC', 'USDT', 'ETH'], 'the dollars first, then what it holds');
  assert.equal(receiveNetworkWords(ex[0]), 'Ethereum');
  // the agent wallet the Account holds the key of
  assert.deepEqual(rows.filter(r => r.venue === 'agent-claude-code').map(r => r.id), ['agent-claude-code|evm']);
  // the stand-in's exchange gives no deposit address
  assert.equal(rows.some(r => r.venue === 'ex'), false);
  // a Polymarket wallet
  const poly = receiveRowsOf(page({ extra: [mine({ id: 'polymarket', name: 'Polymarket', connector: 'live:polymarket' })] })).find(r => r.venue === 'polymarket');
  assert.deepEqual([poly.id, poly.network, poly.networks, poly.asset, poly.chip], ['polymarket|Polygon', 'Polygon', ['Polygon'], 'PUSD', false]);
});

test('a watched address and a venue not served here give no row', () => {
  const p = page({ extra: [mine({ id: 'watched', proven: undefined }), okx({ id: 'away', notServed: { said: 'OKX does not serve this network' } }), okx({ id: 'ro', readOnlyBecause: 'its key reads only' })] });
  const venues = new Set(receiveRowsOf(p).map(r => r.venue));
  assert.equal(venues.has('watched'), false, 'a watched address');
  assert.equal(venues.has('away'), false, 'not served here');
  assert.equal(venues.has('ro'), false, 'read only');
  assert.equal(servedHere(pageVenueOf(p, 'away')), false);
  assert.equal(canReceive(pageVenueOf(p, 'watched')), false);
  assert.equal(canReceive(pageVenueOf(p, 'agent-claude-code')), true, 'a wallet whose key the Account holds');
  // not connected: no row either
  assert.equal(receiveRowsOf(page({ extra: [okx({ live: false })] })).some(r => r.venue === 'okx'), false);
});

test('canMove: writes on, the key says what moves, not read only, not watched, served here', () => {
  const p = page({ extra: [okx(), mine({ id: 'watched', proven: undefined })] });
  assert.equal(canMove(pageVenueOf(p, 'ex'), p), true);
  assert.equal(canMove(pageVenueOf(p, 'okx'), p), true);
  assert.equal(canMove(pageVenueOf(p, 'agent-claude-code'), p), true, 'an agent wallet sends');
  assert.equal(canMove(pageVenueOf(p, 'watched'), p), false, 'a watched address');
  assert.equal(canMove(pageVenueOf(p, 'broker'), p), false, 'no liveCan');
  const off = { ...p, connectLive: { ...p.connectLive, writes: { ...p.connectLive.writes, on: false } } };
  assert.equal(canMove(pageVenueOf(off, 'ex'), off), false, 'a read-only Account');
  const nothing = okx({ id: 'stuck', liveCan: { withdraw: false, ledgers: ['spot'], transfer: false, swap: false, receive: true, send: false } });
  const q = page({ extra: [nothing] });
  assert.equal(canMove(pageVenueOf(q, 'stuck'), q), false, 'nothing moves from it');
  assert.deepEqual(moveSourcesOf(p), [
    { id: 'ex', name: 'Stand-in Exchange', usd: pageVenueOf(p, 'ex').usd, agent: false },
    { id: 'agent-claude-code', name: 'Agent wallet · Claude Code', usd: pageVenueOf(p, 'agent-claude-code').usd, agent: true },
    { id: 'okx', name: 'OKX', usd: null, agent: false },
  ], 'the agent wallets among them, for Take back');
});

test('moveKindsOf follows liveCan', () => {
  const p = page({ extra: [mine(), mine({ id: 'unproven-sender', proven: undefined })] });
  assert.deepEqual(moveKindsOf(pageVenueOf(p, 'ex')).map(k => k.value), ['withdraw', 'transfer', 'swap'], 'an exchange with two ledgers');
  assert.deepEqual(moveKindsOf(pageVenueOf(p, 'ex')).map(k => k.label), ['Withdraw to another account of yours', 'Between its own ledgers', 'Swap stablecoins']);
  assert.deepEqual(moveKindsOf(pageVenueOf(p, 'wallet-mm')), [{ value: 'send', label: 'Send from this wallet' }, { value: 'bridge', label: 'Across chains' }], 'a wallet that sends, proven');
  assert.deepEqual(moveKindsOf(pageVenueOf(p, 'unproven-sender')).map(k => k.value), ['send'], 'bridge once proven');
  assert.deepEqual(moveKindsOf(pageVenueOf(p, 'agent-claude-code')).map(k => k.value), ['send'], "the Account's own wallet sends; it does not bridge");
  assert.deepEqual(moveKindsOf(okx()).map(k => k.value), ['withdraw'], 'one ledger: no transfer');
  assert.deepEqual(moveKindsOf({}), []);
});

test('moveDestinationsOf leaves out the source and names the not-served apart', () => {
  const p = page({ extra: [okx(), okx({ id: 'away', name: 'Away', notServed: { said: 'not here' } }), mine({ id: 'watched', name: 'Watched', proven: undefined }), okx({ id: 'ro', readOnlyBecause: 'reads only' })] });
  const d = moveDestinationsOf(p, pageVenueOf(p, 'okx'));
  assert.deepEqual(d.to.map(x => x.id), ['agent-claude-code', 'watched'], 'never the source, never read-only');
  assert.deepEqual(d.to.find(x => x.id === 'watched').watched, true);
  assert.equal(d.to.find(x => x.id === 'agent-claude-code').funded, 'Base', 'the chain the agent wallet holds dollars on');
  assert.deepEqual(d.notServed, [{ id: 'away', name: 'Away' }]);
  assert.deepEqual(moveDestinationsOf(p, pageVenueOf(p, 'ex')).to.map(x => x.id), ['agent-claude-code', 'okx', 'watched'], 'in the page\'s order');
});

test('moveAssetsOf: the dollars it holds, else the first two the Account knows; any dollar but USD to become', () => {
  const p = fx('account');
  assert.deepEqual(moveAssetsOf(p, pageVenueOf(p, 'ex')).assets, ['USDT', 'USDC']);
  assert.deepEqual(moveAssetsOf(p, { holdings: [] }).assets, ['USDC', 'USDC.E']);
  assert.equal(moveAssetsOf(p, pageVenueOf(p, 'ex')).toAssets.includes('USD'), false);
});

// ── Earn (plan 4b Task 3; earn.js:11-38) ──

test('earnListOf puts the products whose asset is ready first and the closed last', async () => {
  const { earnListOf, earnRate } = await import('../../client/js/host/money-view.js');
  const { earnBody, earnPage } = await import('./helpers/earn-fixture.js');
  const l = earnListOf(earnBody(), earnPage(), 'supply');
  assert.deepEqual(l.products.map(p => p.id), ['flex:USDT', 'flex:DOGE', 'bond:ETH'], 'USDT ready at the exchange first, then DOGE that takes money, then the closed one; OKX not served here');
  assert.equal(l.products[0].ready, 5700, 'what is ready there in USDT: spot and futures, not the 150 already earning');
  assert.equal(l.products[0].held.amount, 150);
  assert.equal(l.products[2].why, 'Full for now');
  assert.deepEqual(l.away, [{ venue: 'okx', venueName: 'OKX', why: 'OKX does not serve this location' }], 'a venue not served here named once, apart');
  assert.deepEqual(l.failed, [{ venue: 'kraken', venueName: 'Kraken', why: 'the venue said 429' }]);
  assert.deepEqual(l.refusing, [{ venue: 'mm', venueName: 'MetaMask', why: 'the agent wallet has not been approved for vaults' }]);
  assert.equal(earnRate(l.products[0]), '4.60% APY', 'earn.js:42');
  assert.equal(earnRate(l.products[2]), '3.00%–5.00% APY');
  assert.equal(earnRate(l.products[1]), '1.00% APR');
  assert.equal(earnRate({ name: 'no rate' }), '');
  // a read's own place refusal takes a venue out too, named once
  const geo = earnBody();
  geo.missing.push({ venue: 'ex', venueName: 'Stand-in Exchange', why: 'blocked here', code: 'E_VENUE_GEOBLOCKED' });
  const away = earnListOf(geo, earnPage(), 'supply');
  assert.deepEqual(away.products, []);
  assert.deepEqual(away.away.map(m => m.venue), ['ex', 'okx']);
  assert.deepEqual(earnListOf({ ok: false, refusal: { message: 'no' } }, earnPage(), 'supply').products, [], 'a refusal lists nothing');
});

test('take out lists only what something is in', async () => {
  const { earnListOf, earnOutAt } = await import('../../client/js/host/money-view.js');
  const { earnBody, earnPage } = await import('./helpers/earn-fixture.js');
  const l = earnListOf(earnBody(), earnPage(), 'withdraw');
  assert.deepEqual(l.products.map(p => [p.id, p.held.amount]), [['flex:USDT', 150]], 'not the ETH product holding nothing, not OKX not served here');
  assert.equal(earnOutAt(earnPage(), 'ex'), true, 'the exchange earns, its key may, it is served');
  assert.equal(earnOutAt(earnPage(), 'okx'), false, 'not served here');
  assert.equal(earnOutAt(earnPage(), 'broker'), false, 'it does not earn');
  const ro = earnPage();
  ro.connectLive.writes.on = false;
  assert.equal(earnOutAt(ro, 'ex'), false, 'an Account that takes no writes');
});

test("a yield's kind is the table's word, an unknown kind as it came", async () => {
  const { withTable } = await import('../../client/js/i18n/words.js');
  const { earnRate } = await import('../../client/js/host/money-view.js');
  withTable({ 'money.earnRate.apy': 'yield {rate} a year', 'money.earnRate.apr': 'rate {rate} a year' }, () => {
    assert.equal(earnRate({ apy: 0.046, rateKind: 'apy' }), 'yield 4.60% a year');
    assert.equal(earnRate({ apy: 0.03, apyHigh: 0.05 }), 'yield 3.00%–5.00% a year', 'a yield with no kind said is an APY');
    assert.equal(earnRate({ apy: 0.01, rateKind: 'apr' }), 'rate 1.00% a year');
    assert.equal(earnRate({ apy: 0.01, rateKind: 'ear' }), '1.00% ear', 'a kind with no word, as it came');
  });
});

test("a wallet's networks are listed under the table's separator", async () => {
  const { withTable } = await import('../../client/js/i18n/words.js');
  const wallet = receiveRowsOf(page({ extra: [okx(), mine()] })).find(r => r.venue === 'wallet-mm');
  assert.equal(withTable({ 'common.list.sep': '、' }, () => receiveNetworkWords(wallet)), 'All EVM networks: Base、Arbitrum、Optimism、Polygon、Ethereum、BNB Chain、Robinhood Chain');
});
