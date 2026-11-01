// The move sheet (plan 4b Task 2): host/sheet-money.js over the stand-in's page — the Account page's own `liveMove` draft and its
// fields by kind (account/src/portfolio/public/ui/money.js openLiveMove :59-100), the fields following the source and the kind
// (`refieldsOf`, through the owner reducer's sheetField), and a bridge's routes line (money.js:105-118).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moveSeedOf, moveHintsOf, routesWordsOf } from '../../client/js/host/sheet-money.js';
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
