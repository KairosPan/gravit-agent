// The move sheet (plan 4b Task 2): host/sheet-money.js over the stand-in's page — the Account page's own `liveMove` draft and its
// fields by kind (account/src/portfolio/public/ui/money.js openLiveMove :59-100), the fields following the source and the kind
// (`refieldsOf`, through the owner reducer's sheetField), and a bridge's routes line (money.js:105-118).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moveSeedOf, moveHintsOf, routesWordsOf, subWalletSeedOf } from '../../client/js/host/sheet-money.js';
import { fieldsOf, draftOf, titleOf, goWord, refieldsOf } from '../../client/js/host/sheet-view.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';

const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const NOW = 1_792_854_000_000;
const mine = (over = {}) => ({
  id: 'wallet-mm', name: 'My wallet', live: true, watchOnly: 'Live · read-only', connector: 'live:wallet', address: '0x1111111111111111111111111111111111111111',
  proven: 'signed by its wallet', liveCan: { withdraw: false, ledgers: [], transfer: false, swap: false, receive: true, send: 'wallet' },
  holdings: [{ asset: 'USDC', amount: 80, usd: 80, class: 'stable', note: 'Base' }], ...over,
});
const page = (extra = []) => { const p = fx('account'); p.venues = [...p.venues, ...extra]; return p; };
const names = fields => fields.map(f => f.name);
const valueOf = (fields, name) => fields.find(f => f.name === name)?.value;
const set = (fields, values) => fields.map(f => (Object.hasOwn(values, f.name) ? { ...f, value: values[f.name] } : f));
// a field changed as the reducer changes it: the value, then the fields rebuilt
const change = (fields, seed, name, value) => refieldsOf('move', set(fields, { [name]: value }), seed);

test('the move sheet: its sources, its kinds, title and go word', () => {
  const seed = moveSeedOf(page(), { from: 'ex' });
  assert.deepEqual(seed.sources.map(s => s.id), ['ex', 'agent-claude-code']);
  assert.equal(seed.capUsd, 250);
  const fields = fieldsOf('move', seed);
  assert.deepEqual(names(fields), ['from', 'kind', 'to', 'network', 'asset', 'amount'], 'a withdrawal first, its fields');
  assert.deepEqual(fields[0].options, [{ value: 'ex', label: 'Stand-in Exchange' }, { value: 'agent-claude-code', label: 'Agent wallet · Claude Code' }]);
  assert.deepEqual(fields[1].options.map(o => o.label), ['Withdraw to another account of yours', 'Between its own ledgers', 'Swap stablecoins']);
  assert.equal(valueOf(fields, 'to'), 'agent-claude-code');
  assert.equal(valueOf(fields, 'network'), 'Base', 'money to an agent wallet starts on the chain it holds money on');
  assert.equal(valueOf(fields, 'asset'), 'USDT', 'the dollars it holds');
  assert.equal(titleOf('move', seed, fields), 'Move money · Stand-in Exchange');
  assert.equal(titleOf('move', seed, set(fields, { from: 'agent-claude-code' })), 'Move money · Agent wallet · Claude Code', 'the source picked');
  assert.equal(goWord('move', seed), 'Sign and move');
  assert.deepEqual(moveHintsOf({ kind: 'move', seed, fields }), ['Only to your own accounts. Up to $250.00 a move.']);
});

test('the transfer draft names the same venue twice and no network', () => {
  const seed = moveSeedOf(page(), { from: 'ex', kind: 'transfer', amount: '50' });
  const fields = fieldsOf('move', seed);
  assert.deepEqual(names(fields), ['from', 'kind', 'fromLedger', 'toLedger', 'asset', 'amount']);
  assert.deepEqual([valueOf(fields, 'fromLedger'), valueOf(fields, 'toLedger')], ['spot', 'futures'], 'money.js:80');
  assert.deepEqual(draftOf('move', fields, seed, NOW), {
    type: 'liveMove', kind: 'transfer', from: 'ex', to: 'ex', fromLedger: 'spot', toLedger: 'futures', asset: 'USDT', toAsset: 'USDT', network: '', amount: '50',
  });
});

test('a swap names toAsset, a withdraw the destination and network', () => {
  const swapSeed = moveSeedOf(page(), { from: 'ex', kind: 'swap' });
  const swap = set(fieldsOf('move', swapSeed), { amount: '12.5' });
  assert.deepEqual(names(swap), ['from', 'kind', 'asset', 'toAsset', 'amount']);
  assert.equal(valueOf(swap, 'toAsset'), 'USDC', 'money.js:82: the first it can become that is not what it sells');
  assert.deepEqual(draftOf('move', swap, swapSeed, NOW), {
    type: 'liveMove', kind: 'swap', from: 'ex', to: 'ex', fromLedger: '', toLedger: '', asset: 'USDT', toAsset: 'USDC', network: '', amount: '12.5',
  });
  const seed = moveSeedOf(page(), { from: 'ex' });
  const w = set(fieldsOf('move', seed), { network: 'Arbitrum', asset: 'USDC', amount: '25' });
  assert.deepEqual(draftOf('move', w, seed, NOW), {
    type: 'liveMove', kind: 'withdraw', from: 'ex', to: 'agent-claude-code', fromLedger: '', toLedger: '', asset: 'USDC', toAsset: 'USDC', network: 'Arbitrum', amount: '25',
  });
  // a bridge from a proven wallet: to this wallet on the other chain, or a proven destination
  const bseed = moveSeedOf(page([mine()]), { from: 'wallet-mm', kind: 'bridge', amount: '20' });
  const b = fieldsOf('move', bseed);
  assert.deepEqual(names(b), ['from', 'kind', 'to', 'network', 'toLedger', 'asset', 'toAsset', 'amount']);
  assert.deepEqual(b.find(f => f.name === 'to').options.map(o => o.value), ['wallet-mm', 'agent-claude-code']);
  assert.deepEqual([valueOf(b, 'network'), valueOf(b, 'toLedger')], ['Ethereum', 'Optimism'], 'the first two chains a bridge joins');
  assert.deepEqual(draftOf('move', b, bseed, NOW), {
    type: 'liveMove', kind: 'bridge', from: 'wallet-mm', to: 'wallet-mm', fromLedger: '', toLedger: 'Optimism', asset: 'USDC', toAsset: 'USDC', network: 'Ethereum', amount: '20',
  });
});

test('no amount: the fill-it-in words; no destination: connect first', () => {
  const seed = moveSeedOf(page(), { from: 'ex' });
  assert.equal(draftOf('move', fieldsOf('move', seed), seed, NOW), 'Fill it in to see where it goes and what it costs.');
  assert.equal(draftOf('move', set(fieldsOf('move', seed), { amount: '0' }), seed, NOW), 'Fill it in to see where it goes and what it costs.');
  // a page where nothing takes money: no To field, and the words to connect one first
  const p = page();
  p.venues = p.venues.map(v => (v.id === 'agent-claude-code' ? { ...v, liveCan: { ...v.liveCan, receive: false } } : v));
  const lone = moveSeedOf(p, { from: 'ex', amount: '10' });
  const fields = fieldsOf('move', lone);
  assert.equal(names(fields).includes('to'), false);
  assert.equal(draftOf('move', fields, lone, NOW), 'Connect where it should go first.');
  // a watched destination is named so and never offered
  const q = page([mine({ id: 'watched', name: 'Watched', proven: undefined })]);
  const wseed = moveSeedOf(q, { from: 'ex', to: 'watched' });
  const to = fieldsOf('move', wseed).find(f => f.name === 'to');
  assert.deepEqual(to.options.find(o => o.value === 'watched'), { value: 'watched', label: 'Watched · watched', disabled: true });
  assert.equal(to.value, 'agent-claude-code', 'a watched address is not picked');
  // no source at all: a read-only Account
  const off = fx('account');
  off.connectLive.writes.on = false;
  const none = moveSeedOf(off, {});
  assert.deepEqual(none.sources, []);
  assert.equal(draftOf('move', fieldsOf('move', none), none, NOW), 'No account to move money from');
  assert.equal(titleOf('move', none, fieldsOf('move', none)), 'Move money');
});

test('refieldsOf on a kind change keeps amount and asset and drops to and network, and the old kind\'s fields never reach the draft', () => {
  const seed = moveSeedOf(page(), { from: 'ex' });
  const withdraw = set(fieldsOf('move', seed), { network: 'Arbitrum', asset: 'USDC', amount: '30' });
  const swap = change(withdraw, seed, 'kind', 'swap');
  assert.deepEqual(names(swap), ['from', 'kind', 'asset', 'toAsset', 'amount'], 'to and network gone');
  assert.deepEqual([valueOf(swap, 'kind'), valueOf(swap, 'asset'), valueOf(swap, 'amount')], ['swap', 'USDC', '30'], 'the amount and the asset kept');
  const d = draftOf('move', swap, seed, NOW);
  assert.equal(d.to, 'ex', 'never the withdrawal\'s destination');
  assert.equal(d.network, '', 'never the withdrawal\'s network');
  // and back: to and network are the page's own start again, not what they were
  const back = change(swap, seed, 'kind', 'withdraw');
  assert.deepEqual(names(back), ['from', 'kind', 'to', 'network', 'asset', 'amount']);
  assert.equal(valueOf(back, 'network'), 'Base');
  assert.equal(valueOf(back, 'amount'), '30');
  // a transfer's ledgers never reach a withdrawal
  const transfer = change(withdraw, seed, 'kind', 'transfer');
  assert.deepEqual(draftOf('move', change(transfer, seed, 'kind', 'withdraw'), seed, NOW).fromLedger, '');
  // nothing changed: the same fields
  assert.deepEqual(refieldsOf('move', withdraw, seed), withdraw);
  // another kind's fields are its own
  const other = [{ name: 'usd', value: '1' }];
  assert.equal(refieldsOf('topUp', other, {}), other);
});

test('refieldsOf on a source change offers its kinds and keeps what it still takes', () => {
  // an exchange that gives deposit addresses, so the agent wallet has somewhere to send (the stand-in's gives none)
  const okx = { id: 'okx', name: 'OKX', live: true, watchOnly: 'Live · read-only', liveCan: { withdraw: true, ledgers: ['spot'], transfer: false, swap: false, receive: true, send: false }, holdings: [] };
  const seed = moveSeedOf(page([okx]), { from: 'ex' });
  const fields = set(fieldsOf('move', seed), { amount: '5', asset: 'USDC' });
  const agent = change(fields, seed, 'from', 'agent-claude-code');
  assert.deepEqual(names(agent), ['from', 'kind', 'to', 'network', 'asset', 'amount']);
  assert.equal(valueOf(agent, 'kind'), 'send', 'its own kind: withdraw is not offered there');
  assert.deepEqual(agent.find(f => f.name === 'to').options.map(o => o.value), ['okx'], 'never itself, never the stand-in exchange that gives no address');
  assert.deepEqual([valueOf(agent, 'asset'), valueOf(agent, 'amount')], ['USDC', '5']);
  assert.equal(titleOf('move', seed, agent), 'Move money · Agent wallet · Claude Code');
});

test('through the reducer: sheetField rebuilds a move\'s fields', () => {
  const seed = moveSeedOf(page(), { from: 'ex' });
  let s = R.sheetOpen(emptyState(), { kind: 'move', seed, fields: fieldsOf('move', seed) });
  s = R.sheetField(s, { name: 'amount', value: '9' });
  s = R.sheetField(s, { name: 'kind', value: 'swap' });
  assert.deepEqual(names(s.sheet.fields), ['from', 'kind', 'asset', 'toAsset', 'amount']);
  assert.equal(valueOf(s.sheet.fields, 'amount'), '9');
  // another kind's fields change as before
  let t = R.sheetOpen(emptyState(), { kind: 'topUp', seed: { venue: 'paper' }, fields: fieldsOf('topUp', { venue: 'paper' }) });
  t = R.sheetField(t, { name: 'usd', value: '7' });
  assert.deepEqual(t.sheet.fields.map(f => [f.name, f.value]), [['usd', '7']]);
});

test('a Top up seed: to the agent wallet, its amount the ask\'s, from the source given', () => {
  const seed = moveSeedOf(page(), { from: 'ex', to: 'agent-claude-code', amount: 40 });
  const fields = fieldsOf('move', seed);
  assert.deepEqual([valueOf(fields, 'to'), valueOf(fields, 'amount'), valueOf(fields, 'network')], ['agent-claude-code', '40', 'Base']);
  assert.equal(draftOf('move', fields, seed, NOW).amount, '40');
});

test('the routes line: finding, the chosen and the others, the Account\'s words, none answered', () => {
  const prepared = { action: { type: 'liveMove', kind: 'bridge', toAsset: 'USDC' } };
  const sheet = { kind: 'move', status: 'ready', prepared, asked: '{"a":1}' };
  assert.deepEqual(routesWordsOf(sheet, { asked: '{"a":1}', status: 'asking' }), { lead: 'Finding the routes…', others: '' });
  assert.deepEqual(routesWordsOf(sheet, { asked: '{"b":2}', status: 'ready', data: { routes: [] } }), { lead: 'Finding the routes…', others: '' }, 'another preparation\'s');
  const routes = [
    { tool: 'across', receiveUsd: 24.81, etaSec: 40, gasUsd: 0.004, feeUsd: 0.19 },
    { tool: 'stargate', receiveUsd: 24.7, etaSec: 600, feeUsd: 0.3 },
    { tool: 'hop', receiveUsd: 24.5, etaSec: 7200, feeUsd: 0.5 },
  ];
  assert.deepEqual(routesWordsOf(sheet, { asked: '{"a":1}', status: 'ready', data: { ok: true, routes } }), {
    lead: 'Via across · at least $24.81 USDC arrives · ~40 s · network fee about $0.004 in your wallet',
    others: 'Other routes: stargate fee $0.30, ~10 min; hop fee $0.50, ~2 h',
  });
  assert.deepEqual(routesWordsOf(sheet, { asked: '{"a":1}', status: 'ready', data: { ok: true, routes: [{ tool: 'x', receiveUsd: 1, etaSec: 0 }] } }),
    { lead: 'Via x · at least $1.00 USDC arrives · ~1 s', others: '' }, 'no network fee said where none is given');
  assert.deepEqual(routesWordsOf(sheet, { asked: '{"a":1}', status: 'error', message: 'no bridge joins these chains' }), { lead: 'no bridge joins these chains', others: '' });
  assert.deepEqual(routesWordsOf(sheet, { asked: '{"a":1}', status: 'error', message: null }), { lead: 'No route answered.', others: '' });
  assert.deepEqual(routesWordsOf(sheet, { asked: '{"a":1}', status: 'ready', data: { ok: true, routes: [] } }), { lead: 'No route answered.', others: '' });
  assert.equal(routesWordsOf({ ...sheet, prepared: { action: { kind: 'withdraw' } } }, {}), null, 'a bridge only');
  assert.equal(routesWordsOf({ ...sheet, kind: 'topUp' }, {}), null);
});

// a second agent wallet, funded on Optimism, and an exchange that receives (it holds nothing a network follows)
const second = { id: 'agent-scout', name: 'Agent wallet · Scout', live: true, watchOnly: 'Live · read-only', connector: 'live:agent-wallet', address: '0x' + '22'.repeat(20), proven: 'this account holds its key',
  liveCan: { withdraw: false, ledgers: [], transfer: false, swap: false, receive: true, send: 'account' }, holdings: [{ asset: 'USDC', amount: 5, usd: 5, class: 'stable', note: 'Optimism' }] };
const okx = { id: 'okx', name: 'OKX', live: true, watchOnly: 'Live · read-only', liveCan: { withdraw: true, ledgers: ['spot'], transfer: false, swap: false, receive: true, send: false }, holdings: [] };

test('the network follows every change of destination to the chain it holds money on, and the pick stands otherwise', () => {
  const seed = moveSeedOf(page([second, okx]), { from: 'ex', to: 'agent-claude-code', amount: '10' });
  let fields = fieldsOf('move', seed);
  assert.equal(valueOf(fields, 'network'), 'Base', 'the first wallet holds its money on Base');
  fields = change(fields, seed, 'to', 'agent-scout');
  assert.equal(valueOf(fields, 'network'), 'Optimism', 'money to a second agent wallet lands on that wallet\'s chain');
  assert.equal(draftOf('move', fields, seed, NOW).network, 'Optimism');
  fields = change(fields, seed, 'network', 'Arbitrum');
  assert.equal(valueOf(fields, 'network'), 'Arbitrum', 'the operator\'s own pick stands while the destination does not change');
  fields = change(fields, seed, 'amount', '12');
  assert.equal(valueOf(fields, 'network'), 'Arbitrum');
  fields = change(fields, seed, 'to', 'okx');
  assert.equal(valueOf(fields, 'network'), 'Arbitrum', 'a destination holding nothing leaves the network as picked');
  fields = change(fields, seed, 'to', 'agent-claude-code');
  assert.equal(valueOf(fields, 'network'), 'Base', 'and back to the first wallet: its chain again');
});

test('every destination watched: the To select still lists them, disabled, and nothing is picked', () => {
  const p = page([{ id: 'watched', name: 'Watched', live: true, watchOnly: 'Live · read-only', address: '0x' + '33'.repeat(20), liveCan: { withdraw: false, ledgers: [], transfer: false, swap: false, receive: true, send: false }, holdings: [] }]);
  p.venues = p.venues.map(v => (v.id === 'agent-claude-code' ? { ...v, liveCan: { ...v.liveCan, receive: false } } : v));
  const seed = moveSeedOf(p, { from: 'ex', amount: '10' });
  const to = fieldsOf('move', seed).find(f => f.name === 'to');
  assert.deepEqual(to.options, [{ value: 'watched', label: 'Watched · watched', disabled: true }]);
  assert.equal(to.value, '');
  assert.equal(draftOf('move', fieldsOf('move', seed), seed, NOW), 'Connect where it should go first.');
});

test("the page's lines under a move's quote: where it goes, a bridge's delivery, Can't be undone.", async () => {
  const { moveSaysOf } = await import('../../client/js/host/sheet-money.js');
  const seed = moveSeedOf(page([okx]), { from: 'ex' });
  const at = action => ({ kind: 'move', seed, prepared: { action } });
  assert.deepEqual(moveSaysOf(at({ kind: 'withdraw', from: 'ex', to: 'agent-claude-code', toAddress: '0x7f' })), ["The agent wallet's own address: this account holds its key.", "Can't be undone."]);
  assert.deepEqual(moveSaysOf(at({ kind: 'withdraw', from: 'ex', to: 'okx', toAddress: '0xabc' })), ["OKX's deposit address, checked again before sending.", "Can't be undone."]);
  assert.deepEqual(moveSaysOf(at({ kind: 'swap', from: 'ex', to: 'ex' })), ["Can't be undone."]);
  assert.deepEqual(moveSaysOf(at({ kind: 'bridge', from: 'ex', to: 'ex', toLedger: 'Optimism' })), ["Your wallet sends it; it lands on Optimism when the bridge delivers. Can't be undone."]);
  assert.deepEqual(moveSaysOf({ kind: 'move', seed }), []);
  assert.deepEqual(moveSaysOf({ kind: 'topUp', prepared: { action: {} } }), []);
});

// ── Earn (plan 4b Task 3; earn.js openEarn :40-196) ──

test('earn drafts supply and withdraw, all of it as all', async () => {
  const { earnSeedOf, earnHintsOf, earnSaysOf, earnSaidOf } = await import('../../client/js/host/sheet-money.js');
  const { earnBody, earnPage } = await import('./helpers/earn-fixture.js');
  const seed = earnSeedOf(earnBody(), earnPage(), {});
  const fields = fieldsOf('earn', seed);
  assert.deepEqual(fields.map(f => [f.name, f.type]), [['side', 'seg'], ['product', 'select'], ['amount', 'number']], 'Put in: no All of it');
  assert.deepEqual(fields[0].options, [{ value: 'supply', label: 'Put in' }, { value: 'withdraw', label: 'Take out' }]);
  assert.deepEqual(fields[1].options, [
    { value: 'ex|flex:USDT', label: 'USDT · Flexible (stand-in) · Stand-in Exchange · USDT · 4.60% APY' },
    { value: 'ex|flex:DOGE', label: 'DOGE · Flexible · Stand-in Exchange · DOGE · 1.00% APR' },
    { value: 'ex|bond:ETH', label: 'ETH · Bonded · Stand-in Exchange · ETH · 3.00%–5.00% APY · Closed: Full for now', disabled: true },
  ]);
  assert.equal(valueOf(fields, 'product'), 'ex|flex:USDT', 'the first that takes money');
  assert.equal(fields[2].label, 'Amount (USDT)');
  assert.equal(titleOf('earn', seed, fields), 'Earn');
  assert.equal(goWord('earn', seed, fields), 'Sign and put in');
  assert.equal(draftOf('earn', fields, seed, NOW), 'Type an amount.');
  assert.deepEqual(draftOf('earn', set(fields, { amount: '25' }), seed, NOW),
    { type: 'liveEarn', venue: 'ex', kind: 'supply', product: 'flex:USDT', asset: 'USDT', amount: '25' }, 'earn.js:40');
  assert.deepEqual(earnHintsOf({ kind: 'earn', seed, fields }), ['5,700 USDT at Stand-in Exchange', 'Money taken out lands in the funding account.', 'At least 1 USDT.']);
  // Take out: the side changed, the fields rebuilt — only what something is in, and All of it
  const out = refieldsOf('earn', set(fields, { side: 'withdraw', amount: '25' }), seed);
  assert.deepEqual(out.map(f => f.name), ['side', 'product', 'amount', 'all']);
  assert.deepEqual(out[1].options.map(o => o.value), ['ex|flex:USDT']);
  assert.equal(valueOf(out, 'amount'), '25', 'the same asset: the amount stays');
  assert.equal(goWord('earn', seed, out), 'Sign and take out');
  assert.equal(draftOf('earn', set(out, { amount: '' }), seed, NOW), 'Type an amount, or take all of it.');
  assert.deepEqual(draftOf('earn', out, seed, NOW), { type: 'liveEarn', venue: 'ex', kind: 'withdraw', product: 'flex:USDT', asset: 'USDT', amount: '25' });
  assert.deepEqual(draftOf('earn', set(out, { all: true }), seed, NOW), { type: 'liveEarn', venue: 'ex', kind: 'withdraw', product: 'flex:USDT', asset: 'USDT', amount: 'all' }, 'the box ticked');
  assert.equal(draftOf('earn', set(out, { amount: 'ALL' }), seed, NOW).amount, 'all', 'the word typed (earn.js:138)');
  assert.equal(draftOf('earn', set(fields, { amount: 'all' }), seed, NOW), 'Type an amount.', 'all of it is a withdrawal\'s only');
  // back to Put in: All of it goes with Take out and never reaches the draft
  const back = refieldsOf('earn', set(out, { side: 'supply', all: true }), seed);
  assert.deepEqual(back.map(f => f.name), ['side', 'product', 'amount']);
  assert.equal(draftOf('earn', back, seed, NOW).amount, '25');
  // a product in another asset: the amount typed for USDT is not carried (earn.js:93-97)
  const doge = refieldsOf('earn', set(fields, { amount: '25', product: 'ex|flex:DOGE' }), seed);
  assert.equal(valueOf(doge, 'amount'), '');
  assert.equal(doge[2].label, 'Amount (DOGE)');
  // a seed for the product an Earning row names, on Take out
  const preset = earnSeedOf(earnBody(), earnPage(), { venue: 'ex', side: 'withdraw', product: 'flex:USDT' });
  assert.equal(valueOf(fieldsOf('earn', preset), 'product'), 'ex|flex:USDT');
  assert.equal(valueOf(fieldsOf('earn', preset), 'side'), 'withdraw');
  // the quote's lines and what a taken one said
  const prepared = { action: { type: 'liveEarn' }, shown: [], quote: { earn: { words: 'take 25 USDT out of USDT · Flexible at Stand-in Exchange', usd: 25, apy: 0.046, lockDays: 0, lands: 'the funding account', held: { amount: 150, asset: 'USDT', usd: 150 } } } };
  assert.deepEqual(earnSaysOf({ kind: 'earn', prepared }), ['≈ $25.00', '4.60% APY · out at once', 'Taken out, it lands in the funding account', 'In it now: 150 USDT ($150.00)']);
  assert.equal(earnSaidOf({ ok: true, kind: 'result', result: { earn: { kind: 'withdraw', all: true, asset: 'USDT', productName: 'USDT · Flexible', status: 'done' } } }), 'Taking out all USDT · USDT · Flexible: done');
  assert.equal(earnSaidOf({ ok: true, kind: 'result', result: { earn: { kind: 'supply', amount: 25, asset: 'USDT', productName: 'USDT · Flexible', status: 'pending', note: 'the venue settles it' } } }), 'Putting in 25 USDT · USDT · Flexible: pending · the venue settles it');
});

test('no product picked: Pick a product', async () => {
  const { earnSeedOf } = await import('../../client/js/host/sheet-money.js');
  const { earnBody, earnPage } = await import('./helpers/earn-fixture.js');
  const body = earnBody();
  for (const p of body.products) p.canSupply = false;
  const seed = earnSeedOf(body, earnPage(), {});
  const fields = fieldsOf('earn', seed);
  assert.equal(valueOf(fields, 'product'), '', 'every product closed: none picked');
  assert.equal(draftOf('earn', set(fields, { amount: '25' }), seed, NOW), 'Pick a product');
  assert.equal(draftOf('earn', set(fields, { amount: '25', product: 'ex|nope' }), seed, NOW), 'Pick a product', 'a product the list does not have');
  const empty = earnSeedOf({ ok: true, products: [], positions: [], venues: [], missing: [] }, earnPage(), {});
  assert.equal(draftOf('earn', fieldsOf('earn', empty), empty, NOW), 'No product takes money from here right now.');
  assert.equal(draftOf('earn', fieldsOf('earn', { ...empty, side: 'withdraw' }), { ...empty, side: 'withdraw' }, NOW), 'Nothing is earning to take out.');
});

test('the earn sheet through the owner reducer: Take out picked, All of it ticked', async () => {
  const { earnSeedOf } = await import('../../client/js/host/sheet-money.js');
  const { earnBody, earnPage } = await import('./helpers/earn-fixture.js');
  const seed = earnSeedOf(earnBody(), earnPage(), {});
  let s = R.sheetOpen(emptyState(), { kind: 'earn', seed, fields: fieldsOf('earn', seed) });
  s = R.sheetField(s, { name: 'side', value: 'withdraw' });
  assert.deepEqual(s.sheet.fields.map(f => f.name), ['side', 'product', 'amount', 'all']);
  s = R.sheetField(s, { name: 'all', value: true });
  assert.equal(draftOf('earn', s.sheet.fields, seed, NOW).amount, 'all');
});

// ── An agent wallet (plan 4b Task 5; portfolio.js pfWalletForm :1263-1279) ──

const CC = '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6';
const keysPage = () => {
  const p = fx('account');
  p.keys = [...p.keys, { address: '0xABCDEF0000000000000000000000000000000001', name: 'Scout', status: 'ok' }, { address: '0x02', name: 'Old', status: 'expired' }];
  return p;
};

test('subWallet drafts createSubAccount with the agent lowercased', () => {
  const seed = subWalletSeedOf(keysPage(), { agent: '0xabcdef0000000000000000000000000000000001' });
  const fields = fieldsOf('subWallet', seed);
  assert.deepEqual(fields.map(f => [f.name, f.type, f.label]), [['name', 'text', 'Name'], ['agent', 'select', 'For agent'], ['float', 'number', 'Keeps up to ($)']]);
  // the keys let in and standing, by address; an expired one is not offered; the preset's picked, in any case
  assert.deepEqual(fields[1].options, [{ value: CC, label: 'Claude Code' }, { value: '0xABCDEF0000000000000000000000000000000001', label: 'Scout' }]);
  assert.equal(valueOf(fields, 'agent'), '0xABCDEF0000000000000000000000000000000001');
  assert.deepEqual(draftOf('subWallet', set(fields, { name: ' research bot ', float: '50' }), seed, NOW),
    { type: 'createSubAccount', name: 'research bot', agent: '0xabcdef0000000000000000000000000000000001', float: '50' });
  assert.equal(titleOf('subWallet', seed), 'An agent wallet');
  assert.equal(goWord('subWallet', seed), 'Make it');
  // no preset: the first key; a preset that is no key let in: the first too
  assert.equal(valueOf(fieldsOf('subWallet', subWalletSeedOf(keysPage())), 'agent'), CC);
  assert.equal(valueOf(fieldsOf('subWallet', subWalletSeedOf(keysPage(), { agent: '0x02' })), 'agent'), CC);
  // the preset's name and float fill the form (an ask's: portfolio.js:1266)
  const asked = fieldsOf('subWallet', subWalletSeedOf(keysPage(), { name: 'Claude', float: 25 }));
  assert.deepEqual([valueOf(asked, 'name'), valueOf(asked, 'float')], ['Claude', '25']);
  assert.deepEqual(subWalletSeedOf({ ok: false }), { agent: '', name: '', float: '', keys: [] });
});

test("subWallet's words: a name of letters and digits up to 16, how much it keeps, an agent let in", () => {
  const seed = subWalletSeedOf(keysPage());
  const fields = set(fieldsOf('subWallet', seed), { name: 'research', float: '50' });
  for (const name of ['', '  ', '-lead', '_x', 'a'.repeat(17), 'bad!name', 'émile']) {
    assert.equal(draftOf('subWallet', set(fields, { name }), seed, NOW), 'A name of letters and digits, up to 16', JSON.stringify(name));
  }
  for (const name of ['a', 'A1 b_c-d', 'x'.repeat(16)]) assert.equal(draftOf('subWallet', set(fields, { name }), seed, NOW).name, name);
  for (const float of ['', '0', '-5', 'lots']) assert.equal(draftOf('subWallet', set(fields, { float }), seed, NOW), 'How much it keeps at most', float);
  assert.equal(draftOf('subWallet', set(fields, { agent: '0x02' }), seed, NOW), 'Pick the agent it pays for');
  // nobody let in: no agent to pick
  const none = subWalletSeedOf({ ...fx('account'), keys: [] });
  assert.deepEqual(fieldsOf('subWallet', none)[1].options, []);
  assert.equal(draftOf('subWallet', set(fieldsOf('subWallet', none), { name: 'research', float: '50' }), none, NOW), 'Pick the agent it pays for');
});
