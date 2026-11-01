// Every sheet's fields, title, go word and draft (spec 2026-10-22 §6.3–§6.4, plan 2 Task 4): each draft the Account's own
// shape for its type (the owner-path map §1.4–§1.5, §3.8–§3.10, §3.12, §3.14, §3.15, §3.17, §4.3) — nothing added, nothing
// renamed — or, while the form is not complete, the words for what is missing; and which sheet grants an agent's ask.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHEET_KINDS, fieldsOf, refieldsOf, draftOf, titleOf, goWord, grantOf, limitSeedOf, letDeviceSeedOf, paperSeedOf, connectCheckOf } from '../../client/js/host/sheet-view.js';
import { venuesOf, connectOptionsOf } from '../../client/js/host/account-view.js';

const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 9, 22, 7, 35, 46);
const DAY = 86_400_000;
const ZERO = '0x0000000000000000000000000000000000000000';
// the form as the owner left it: each named field's value set, the rest as fieldsOf drew them
const set = (fields, values) => fields.map(f => (Object.hasOwn(values, f.name) ? { ...f, value: values[f.name] } : f));
const valueOf = (fields, name) => fields.find(f => f.name === name)?.value;
const AGENT = '0x3a087530887bd175ccc38828ee3776e5b6ea1ac6';

test('SHEET_KINDS: every kind with a title and its go word', () => {
  assert.deepEqual(SHEET_KINDS, ['letIn', 'limit', 'endLimit', 'revoke', 'connect', 'paper', 'topUp', 'resetPaper', 'disconnect',
    'approveCard', 'declineAsk', 'letDevice', 'signOut', 'order', 'reopen', 'close', 'amend', 'leverage', 'beast', 'cap', 'session', 'leverageCap', 'move', 'earn', 'subWallet']);
  assert.deepEqual(SHEET_KINDS.map(k => goWord(k)), ['Let it in', 'Give the limit', 'End the limit', 'Revoke', 'Connect', 'Open the account',
    'Top up', 'Start over', 'Disconnect', 'Approve', 'Decline', 'Let it sign', 'Sign out', 'Sign and place', 'Sign and reopen', 'Sign and close', 'Sign and change', 'Sign leverage',
    'Sign Beast', 'Sign the cap', 'Renew for 30 days', 'Sign leverage', 'Sign and move', 'Sign and put in', 'Make it']);
  assert.equal(goWord('approveCard', { decision: 'reject' }), 'Reject');
  assert.equal(goWord('approveCard', { decision: 'approve' }), 'Approve');
  for (const k of SHEET_KINDS) assert.ok(titleOf(k, {}).length > 0, k);
  assert.equal(titleOf('letIn', { name: 'Claude Code' }), 'Let Claude Code in');
  assert.equal(goWord('nonsense'), '');
});

test('letIn: approveAgent for the knocking key, its address lower-cased, good for the days picked', () => {
  const seed = { address: '0x3A087530887BD175CCC38828EE3776E5B6EA1AC6', name: 'Claude Code' };
  const fields = fieldsOf('letIn', seed);
  assert.deepEqual(fields.map(f => [f.name, f.type]), [['address', 'text'], ['name', 'text'], ['days', 'seg']]);
  assert.deepEqual(valueOf(fields, 'days'), '30');
  assert.deepEqual(fields.find(f => f.name === 'days').options.map(o => o.value), ['1', '7', '30', '90']);
  assert.deepEqual(draftOf('letIn', set(fields, { days: '7' }), seed, NOW),
    { type: 'approveAgent', agentAddress: AGENT, agentName: 'Claude Code', validUntil: NOW + 7 * DAY });
  assert.equal(typeof draftOf('letIn', set(fields, { address: '' }), seed, NOW), 'string');
  assert.equal(typeof draftOf('letIn', set(fields, { address: '0x3a08' }), seed, NOW), 'string');
  assert.equal(typeof draftOf('letIn', set(fields, { name: '  ' }), seed, NOW), 'string');
});

test('limit: approveSpend over the venues picked, paper first, the amounts as typed', () => {
  const venues = venuesOf(fx('account'));
  const seed = { address: AGENT, name: 'Claude Code', venues };
  const fields = fieldsOf('limit', seed);
  assert.deepEqual(fields.map(f => [f.name, f.type]), [['scope', 'seg'], ['allow', 'pick'], ['perPayment', 'number'], ['budget', 'number'], ['days', 'seg']]);
  // a seed of venues alone gives a trading limit
  const ids = fields.find(f => f.name === 'allow').options.map(o => o.value);
  assert.deepEqual(ids.slice(0, 2), ['paper', 'paper-momentum']);
  assert.equal(ids.length, venues.length);
  assert.deepEqual(valueOf(fields, 'allow'), []);
  const done = set(fields, { allow: ['ex', 'paper-momentum'], perPayment: '100', budget: '1000', days: '30' });
  assert.deepEqual(draftOf('limit', done, seed, NOW), {
    type: 'approveSpend', agent: AGENT, scope: 'trade', allow: 'paper-momentum,ex', perPayment: '100', budget: '1000', windowHours: 0, validUntil: NOW + 30 * DAY,
  });
  // what is still missing, in words
  assert.equal(draftOf('limit', set(done, { allow: [] }), seed, NOW), 'Pick at least one venue');
  assert.equal(draftOf('limit', set(done, { perPayment: '' }), seed, NOW), 'Type an amount');
  assert.equal(draftOf('limit', set(done, { budget: '' }), seed, NOW), 'Type a budget');
  assert.equal(typeof draftOf('limit', set(done, { perPayment: '0' }), seed, NOW), 'string');
  assert.equal(typeof draftOf('limit', set(done, { perPayment: '1e3' }), seed, NOW), 'string');
  assert.equal(draftOf('limit', set(done, { perPayment: '2000' }), seed, NOW), 'The amount per order is more than the budget');
});

test('limit: allow is never *, and never a venue the seed does not list', () => {
  const seed = { address: AGENT, name: 'Claude Code', venues: [{ id: '*', name: 'Every venue' }, { id: 'paper', name: 'Paper', paper: true }] };
  const fields = fieldsOf('limit', seed);
  assert.deepEqual(fields.find(f => f.name === 'allow').options.map(o => o.value), ['paper']);
  const draft = draftOf('limit', set(fields, { allow: ['*', 'paper', 'okx'], perPayment: '10', budget: '10' }), seed, NOW);
  assert.equal(draft.allow, 'paper');
  assert.equal(draftOf('limit', set(fields, { allow: ['*'], perPayment: '10', budget: '10' }), seed, NOW), 'Pick at least one venue');
  // a standing limit's venues and an asked one are ticked only where the venue is listed
  assert.deepEqual(valueOf(fieldsOf('limit', { ...seed, current: { allow: ['paper', '*'], perPayment: '', budget: '' }, asked: 'standin-pubex' }), 'allow'), ['paper']);
});

test('endLimit: the same agent, scope and venues at zero, for a day', () => {
  assert.deepEqual(fieldsOf('endLimit', { address: AGENT, allow: 'paper,ex' }), []);
  assert.deepEqual(draftOf('endLimit', [], { address: AGENT, allow: 'paper,ex' }, NOW),
    { type: 'approveSpend', agent: AGENT, scope: 'trade', allow: 'paper,ex', perPayment: '0', budget: '0', windowHours: 0, validUntil: NOW + DAY });
  assert.equal(draftOf('endLimit', [], { address: AGENT, allow: ['paper', 'ex'] }, NOW).allow, 'paper,ex');
  assert.equal(typeof draftOf('endLimit', [], { address: '', allow: 'paper' }, NOW), 'string');
});

// ── every kind of limit (plan 4b Task 5; portfolio.js:1186-1200 pfLimitForm, agents-mount.js:123, :193-196) ──

// the limit sheet as the reducer leaves it: a field set, then the fields rebuilt
const changed = (fields, values, seed) => refieldsOf('limit', set(fields, values), seed);
const pageOf = () => fx('account');

test('a venues limit picks among the venues that move money and the agent wallets', () => {
  const seed = limitSeedOf(pageOf(), AGENT, 'Claude Code', 'venues');
  assert.equal(seed.scope, 'venues');
  const fields = fieldsOf('limit', seed);
  assert.deepEqual(fields.map(f => f.name), ['scope', 'allow', 'perPayment', 'budget', 'days']);
  assert.deepEqual(fields[0].options, [
    { value: 'trade', label: 'Trading' }, { value: 'venues', label: 'Moving money between your accounts' },
    { value: 'earn', label: 'Putting money into earn' }, { value: 'payees', label: 'Paying for things' },
  ]);
  assert.equal(valueOf(fields, 'scope'), 'venues');
  // the exchange moves money; the agent wallet takes it; the broker, the paper books and the event venue move none
  assert.deepEqual(fields.find(f => f.name === 'allow').options.map(o => o.value), ['ex', 'agent-claude-code']);
  // the standing venues limit starts it
  assert.deepEqual([valueOf(fields, 'allow'), valueOf(fields, 'perPayment'), valueOf(fields, 'budget')], [['ex', 'agent-claude-code'], '50', '200']);
  assert.equal(fields.find(f => f.name === 'perPayment').label, 'Per move, in dollars');
  assert.deepEqual(draftOf('limit', set(fields, { allow: ['agent-claude-code', 'ex', 'broker', '*'], perPayment: '25', budget: '100', days: '7' }), seed, NOW), {
    type: 'approveSpend', agent: AGENT, scope: 'venues', allow: 'ex,agent-claude-code', perPayment: '25', budget: '100', windowHours: 0, validUntil: NOW + 7 * DAY,
  });
  assert.equal(draftOf('limit', set(fields, { perPayment: '300' }), seed, NOW), 'The amount per move is more than the budget');
  // an agent wallet that moves no money of its own is offered still, after those that do (portfolio.js:1196)
  const page = pageOf();
  page.venues.push({ id: 'agent-scout', name: 'Agent wallet · Scout', live: true, connector: 'live:agent-wallet' });
  assert.deepEqual(limitSeedOf(page, AGENT, 'Claude Code', 'venues').venues.map(v => v.id), ['ex', 'agent-claude-code', 'agent-scout']);
});

test('an earn limit never drafts *', () => {
  const page = pageOf();
  page.venues.push({ id: '*', name: 'Everywhere', live: true, earn: { can: true } }, { id: 'away', name: 'Away', live: true, earn: { can: true }, notServed: { said: 'no' } },
    { id: 'shut', name: 'Shut', live: true, earn: { can: false } });
  const seed = limitSeedOf(page, AGENT, 'Claude Code', 'earn');
  const fields = fieldsOf('limit', seed);
  // where earn takes money and is served here, never *, never one that can't earn
  assert.deepEqual(fields.find(f => f.name === 'allow').options.map(o => o.value), ['ex']);
  assert.deepEqual(valueOf(fields, 'allow'), [], 'no earn limit standing: nothing ticked');
  assert.equal(fields.find(f => f.name === 'perPayment').label, 'Each time, in dollars');
  const draft = draftOf('limit', set(fields, { allow: ['*', 'ex', 'away'], perPayment: '10', budget: '50' }), seed, NOW);
  assert.deepEqual(draft, { type: 'approveSpend', agent: AGENT, scope: 'earn', allow: 'ex', perPayment: '10', budget: '50', windowHours: 0, validUntil: NOW + 30 * DAY });
  assert.equal(draftOf('limit', set(fields, { allow: ['*'], perPayment: '10', budget: '50' }), seed, NOW), 'Pick at least one venue');
  // a standing earn limit of * ticks nothing
  page.spend.push({ id: 'spend-9', agent: AGENT, scope: 'earn', allow: ['*'], perPaymentUsd: 5, budgetUsd: 5, expired: false });
  assert.deepEqual(valueOf(fieldsOf('limit', limitSeedOf(page, AGENT, 'Claude Code', 'earn')), 'allow'), []);
});

test('a payees limit drafts the hosts lowercased, or * for any payee', () => {
  const seed = limitSeedOf(pageOf(), AGENT, 'Claude Code', 'payees');
  const fields = fieldsOf('limit', seed);
  assert.deepEqual(fields.map(f => [f.name, f.type, f.label]), [['scope', 'seg', 'For'], ['payees', 'text', 'May pay'], ['anyPayee', 'check', 'Any payee'],
    ['perPayment', 'number', 'Per payment, in dollars'], ['budget', 'number', 'Budget, in dollars'], ['days', 'seg', 'Good for']]);
  // the standing payees limit starts it
  assert.deepEqual([valueOf(fields, 'payees'), valueOf(fields, 'anyPayee'), valueOf(fields, 'perPayment'), valueOf(fields, 'budget')], ['api.example.com', false, '2', '20']);
  assert.deepEqual(draftOf('limit', set(fields, { payees: ' API.Example.com, ,Data.EXAMPLE.com ', perPayment: '1', budget: '20', days: '1' }), seed, NOW), {
    type: 'approveSpend', agent: AGENT, scope: 'payees', allow: 'api.example.com,data.example.com', perPayment: '1', budget: '20', windowHours: 0, validUntil: NOW + DAY,
  });
  // Any payee ticked: *, whatever hosts are typed (the box's value as the page sends it: true, or 'true')
  for (const any of [true, 'true']) assert.equal(draftOf('limit', set(fields, { anyPayee: any }), seed, NOW).allow, '*');
  assert.equal(draftOf('limit', set(fields, { payees: ' , ' }), seed, NOW), 'Name the hosts it may pay, or tick any payee');
  assert.equal(draftOf('limit', set(fields, { perPayment: '21' }), seed, NOW), 'The amount per payment is more than the budget');
  // a standing limit of any payee starts ticked, no host typed
  const page = pageOf();
  page.spend.find(r => r.scope === 'payees').allow = ['*'];
  const any = fieldsOf('limit', limitSeedOf(page, AGENT, 'Claude Code', 'payees'));
  assert.deepEqual([valueOf(any, 'payees'), valueOf(any, 'anyPayee')], ['', true]);
});

test('refieldsOf on a scope change swaps the pick and keeps the amounts', () => {
  const seed = limitSeedOf(pageOf(), AGENT, 'Claude Code');
  const trade = set(fieldsOf('limit', seed), { perPayment: '40', budget: '400', days: '7', allow: ['paper'] });
  // any other change: the fields as they are
  assert.equal(refieldsOf('limit', trade, seed), trade);
  // to venues: that kind's venues, its standing pick; the amounts and the days kept
  const venues = changed(trade, { scope: 'venues' }, seed);
  assert.deepEqual(venues.find(f => f.name === 'allow').options.map(o => o.value), ['ex', 'agent-claude-code']);
  assert.deepEqual([valueOf(venues, 'scope'), valueOf(venues, 'allow'), valueOf(venues, 'perPayment'), valueOf(venues, 'budget'), valueOf(venues, 'days')],
    ['venues', ['ex', 'agent-claude-code'], '40', '400', '7']);
  assert.equal(draftOf('limit', venues, seed, NOW).scope, 'venues');
  // to payees: the hosts and Any payee in the pick's place, the amounts kept
  const payees = changed(venues, { scope: 'payees' }, seed);
  assert.deepEqual(payees.map(f => f.name), ['scope', 'payees', 'anyPayee', 'perPayment', 'budget', 'days']);
  assert.deepEqual([valueOf(payees, 'payees'), valueOf(payees, 'perPayment'), valueOf(payees, 'budget')], ['api.example.com', '40', '400']);
  assert.deepEqual(draftOf('limit', payees, seed, NOW), { type: 'approveSpend', agent: AGENT, scope: 'payees', allow: 'api.example.com', perPayment: '40', budget: '400', windowHours: 0, validUntil: NOW + 7 * DAY });
  // back to trading: its standing pick again, never the venues limit's; a kind the page does not serve changes nothing
  const back = changed(payees, { scope: 'trade' }, seed);
  assert.deepEqual([valueOf(back, 'allow'), valueOf(back, 'perPayment')], [['ex', 'predict', 'wallet'], '40']);
  const odd = set(back, { scope: 'mode' });
  assert.equal(refieldsOf('limit', odd, seed), odd);
  assert.equal(draftOf('limit', odd, seed, NOW), 'Pick what the limit is for');
});

test('limitSeedOf reads the standing limit of the scope asked', () => {
  const page = pageOf();
  const at = scope => limitSeedOf(page, AGENT.toUpperCase().replace('0X', '0x'), 'Claude Code', scope);
  assert.deepEqual(at('trade').current, { allow: ['ex', 'predict', 'wallet'], perPayment: '150', budget: '600' });
  assert.deepEqual(at('venues').current, { allow: ['ex', 'agent-claude-code'], perPayment: '50', budget: '200' });
  assert.deepEqual(at('payees').current, { allow: ['api.example.com'], perPayment: '2', budget: '20' });
  assert.equal(at('earn').current, null);
  assert.deepEqual(Object.keys(at('trade').standing), ['trade', 'venues', 'payees'], 'every kind standing, whichever is asked');
  assert.equal(at().scope, 'trade', 'trading where none is asked');
  // a read-only Account: nothing trades or moves from here — the agent wallets (portfolio.js:1196 offers them whether or not
  // they move), earn and payees, a trading ask opening on the first served
  const off = { ...page, connectLive: { ...page.connectLive, writes: { on: false, capUsd: 250 } } };
  const ro = limitSeedOf(off, AGENT, 'Claude Code', 'trade');
  assert.deepEqual([ro.scopes.map(x => x.value), ro.scope, ro.venues.map(v => v.id)], [['venues', 'earn', 'payees'], 'venues', ['agent-claude-code']]);
});

test('endLimit ends the scope it names', () => {
  for (const scope of ['trade', 'venues', 'earn', 'payees']) {
    assert.deepEqual(draftOf('endLimit', [], { address: AGENT, scope, allow: scope === 'payees' ? '*' : 'ex' }, NOW),
      { type: 'approveSpend', agent: AGENT, scope, allow: scope === 'payees' ? '*' : 'ex', perPayment: '0', budget: '0', windowHours: 0, validUntil: NOW + DAY });
  }
  assert.equal(draftOf('endLimit', [], { address: AGENT, allow: 'ex' }, NOW).scope, 'trade', 'trading where it names none');
  assert.equal(titleOf('endLimit', { name: 'Gravit', scope: 'venues' }), "End Gravit's limit to move money");
  assert.equal(titleOf('endLimit', { name: 'Gravit', scope: 'payees' }), "End Gravit's payments limit");
  assert.equal(titleOf('endLimit', { name: 'Gravit' }), "End Gravit's trading limit");
  assert.equal(titleOf('limit', { name: 'Gravit', scope: 'earn' }), 'Give Gravit a limit');
});

// ── every connector kind the Account offers (plan 4b Task 4; connect.js openConnect) ──

const connectSeed = (venues = venuesOf(fx('account')).map(v => ({ id: v.id }))) => ({ options: connectOptionsOf(fx('account'), null), venues });
// the connect sheet with a connector picked, as the reducer rebuilds it on the pick, then the values typed
const picked = (seed, connector, values = {}) => set(refieldsOf('connect', set(fieldsOf('connect', seed), { connector }), seed), values);
const HL = '0x' + 'AbCdEf'.repeat(6) + 'abcd';

test('an address connects under the kind, or kind-<6 hex> when the kind is on the page', () => {
  const seed = connectSeed();
  const fields = picked(seed, 'live:hyperliquid', { ref: HL, label: 'Main' });
  assert.deepEqual(fields.map(f => [f.name, f.label, f.type]), [['connector', 'What to connect', 'select'], ['ref', 'Address', 'text'], ['label', 'Shown as', 'text']]);
  assert.equal(fields[1].placeholder, '0x…');
  assert.deepEqual(draftOf('connect', fields, seed, NOW), { type: 'connectVenue', venue: 'hyperliquid', connector: 'live:hyperliquid', label: 'Main', credentialRef: HL });
  // the stand-in's page has a venue called wallet already: a second wallet is numbered by its address, lower-cased
  const wallet = picked(seed, 'live:wallet', { ref: HL, label: '' });
  assert.deepEqual(draftOf('connect', wallet, seed, NOW), { type: 'connectVenue', venue: 'wallet-abcdef', connector: 'live:wallet', label: '', credentialRef: HL });
  assert.equal(draftOf('connect', wallet, connectSeed([]), NOW).venue, 'wallet', 'no wallet on the page: the kind itself');
  // the shape follows the pick: back to a key file, the name kept and the address gone
  const back = refieldsOf('connect', set(wallet, { connector: 'live:alpaca', label: 'Kept' }), seed);
  assert.deepEqual(back.map(f => f.name), ['connector', 'exchange', 'venue', 'label', 'credentialRef']);
  assert.equal(valueOf(back, 'label'), 'Kept');
  // another address kind keeps the form as it is
  assert.equal(refieldsOf('connect', set(wallet, { connector: 'live:hyperliquid' }), seed).find(f => f.name === 'ref').value, HL);
});

test('a bad address is said', () => {
  const seed = connectSeed();
  for (const ref of ['', '0x12', HL.slice(0, 41), `${HL}0`, HL.replace('0x', '0X'), 'z'.repeat(42)]) {
    assert.equal(draftOf('connect', picked(seed, 'live:wallet', { ref }), seed, NOW), 'An address is 0x and 40 hex digits', JSON.stringify(ref));
  }
});

test('a sign-in drafts only once signed in, with the state', () => {
  const seed = connectSeed();
  const fields = picked(seed, 'live:robinhood');
  assert.deepEqual(fields.map(f => [f.name, f.type]), [['connector', 'select'], ['credentialRef', 'hidden']], 'nothing typed: the state lands hidden');
  assert.equal(draftOf('connect', fields, seed, NOW), 'Sign in at Robinhood first');
  assert.deepEqual(draftOf('connect', set(fields, { credentialRef: 'st-123' }), seed, NOW),
    { type: 'connectVenue', venue: 'robinhood', connector: 'live:robinhood', label: '', credentialRef: 'st-123' });
  // a state never carried to another kind
  const other = refieldsOf('connect', set(fields, { connector: 'live:metamask', credentialRef: 'st-123' }), seed);
  assert.deepEqual(other.map(f => f.name), ['connector']);
});

test('a cli option drafts with blank label and ref', () => {
  const seed = connectSeed();
  const fields = picked(seed, 'live:metamask');
  assert.deepEqual(fields.map(f => f.name), ['connector']);
  assert.deepEqual(draftOf('connect', fields, seed, NOW), { type: 'connectVenue', venue: 'metamask', connector: 'live:metamask', label: '', credentialRef: '' });
  // its check line: what to run on this machine, the Account's own example
  const example = seed.options.find(o => o.connector === 'live:metamask').example;
  const none = { status: 'idle', data: null };
  assert.equal(connectCheckOf({ kind: 'connect', seed, fields }, none, none), example);
  const reach = { status: 'ready', data: { ok: true, reach: [{ connector: 'live:metamask', state: 'setup', said: 'mm is not signed in on this machine' }] } };
  assert.equal(connectCheckOf({ kind: 'connect', seed, fields }, none, reach), `${example} · mm is not signed in on this machine`, 'beside its reach');
});

test('no option is Connect on the Account page any more', () => {
  const seed = connectSeed();
  const none = { status: 'idle', data: null };
  const wallet = { status: 'none', wallets: [] }, signIn = { status: 'waiting', connector: 'live:robinhood', tab: true };
  for (const o of seed.options) {
    for (const fields of [picked(seed, o.connector), picked(seed, o.connector, { ref: HL, label: 'x', venue: 'v', credentialRef: 'st' })]) {
      const draft = draftOf('connect', fields, seed, NOW);
      const check = connectCheckOf({ kind: 'connect', seed, fields }, none, none, { wallet, signIn });
      assert.ok(!JSON.stringify(draft).includes('Account page') && !check.includes('Account page'), o.connector);
    }
  }
});

test("the connect sheet's check speaks for the browser wallet and for a sign-in", () => {
  const seed = connectSeed();
  const none = { status: 'idle', data: null };
  const sheet = fields => ({ kind: 'connect', seed, fields });
  const w = picked(seed, 'live:wallet', { ref: HL });
  const check = (fields, more) => connectCheckOf(sheet(fields), none, none, more);
  assert.equal(check(w, { wallet: { status: 'none' } }), 'No browser wallet answered on this page. Type the address to watch it.');
  assert.equal(check(w, { wallet: { status: 'asking', wallet: 'Fake Wallet' } }), 'Waiting for Fake Wallet…');
  assert.equal(check(w, { wallet: { status: 'proven', wallet: 'Fake Wallet', address: HL.toLowerCase() } }), 'Fake Wallet signed: 0xabcdef…abcd is yours.');
  assert.equal(check(set(w, { ref: '0x' + '9'.repeat(40) }), { wallet: { status: 'proven', wallet: 'Fake Wallet', address: HL } }), '', 'another address typed since: not that one');
  assert.equal(check(w, { wallet: { status: 'refused', message: 'User rejected the request.' } }), 'User rejected the request.');
  // a sign-in, for its own option only
  const rh = picked(seed, 'live:robinhood');
  const si = (status, more = {}) => check(rh, { signIn: { status, connector: 'live:robinhood', tab: true, ...more } });
  assert.equal(si('starting'), 'Asking Robinhood where to sign in…');
  assert.equal(si('waiting'), "Sign in on Robinhood's page, then come back.");
  assert.equal(si('waiting', { tab: false }), '', 'no tab: the link is drawn instead');
  assert.equal(si('ready'), 'Signed in. Connect it.');
  assert.equal(si('expired'), 'The sign-in ran out: start again.');
  assert.equal(si('failed', { message: 'access_denied' }), 'access_denied');
  assert.equal(check(rh, { signIn: { status: 'ready', connector: 'live:other' } }), '');
});

test('reopen drafts setPolicy restore', () => {
  const seed = { venue: 'ex', name: 'Stand-in Exchange' };
  assert.equal(titleOf('reopen', seed), 'Reopen Stand-in Exchange to agents');
  assert.equal(goWord('reopen', seed), 'Sign and reopen');
  assert.deepEqual(fieldsOf('reopen', seed), []);
  assert.deepEqual(draftOf('reopen', [], seed, NOW), { type: 'setPolicy', change: 'restore', value: 'ex' });
  assert.equal(draftOf('reopen', [], {}, NOW), 'No venue to reopen');
});

test('revoke: approveAgent with the zero address and the key\'s name, until 0', () => {
  assert.deepEqual(draftOf('revoke', fieldsOf('revoke', { name: 'Claude Code' }), { name: 'Claude Code' }, NOW),
    { type: 'approveAgent', agentAddress: ZERO, agentName: 'Claude Code', validUntil: 0 });
  assert.equal(typeof draftOf('revoke', [], {}, NOW), 'string');
});

test('connect: connectVenue with the connector picked, the venue, its name and the key file\'s path', () => {
  const options = fx('account').connectLive.options;
  const seed = { options };
  const fields = fieldsOf('connect', seed);
  assert.deepEqual(fields.map(f => [f.name, f.type]), [['connector', 'select'], ['exchange', 'select'], ['venue', 'text'], ['label', 'text'], ['credentialRef', 'text']]);
  assert.deepEqual(fields.find(f => f.name === 'exchange').options.map(o => o.value), ['binance', 'okx', 'bybit', 'kraken']);
  const connectors = fields.find(f => f.name === 'connector').options.map(o => o.value);
  assert.ok(connectors.includes('live:exchange'));
  assert.ok(!connectors.includes('live:paper'));   // a paper account is its own sheet
  const done = set(fields, { connector: 'live:alpaca-paper', venue: 'alpaca-paper', label: 'Alpaca paper', credentialRef: 'credentials/alpaca-paper/keys.json' });
  assert.deepEqual(draftOf('connect', done, seed, NOW),
    { type: 'connectVenue', venue: 'alpaca-paper', connector: 'live:alpaca-paper', label: 'Alpaca paper', credentialRef: 'credentials/alpaca-paper/keys.json' });
  // the path left blank is the option's own default, for this venue
  assert.equal(draftOf('connect', set(done, { credentialRef: '' }), seed, NOW).credentialRef, 'credentials/alpaca-paper/api-key.json');
  assert.equal(draftOf('connect', set(done, { connector: '' }), seed, NOW), 'Pick what to connect');
  assert.equal(draftOf('connect', set(done, { venue: '' }), seed, NOW), 'Type a venue id');
  assert.equal(draftOf('connect', set(done, { label: '' }), seed, NOW), 'Type a name');
});

test('connect: an exchange account signs live:exchange:<the exchange picked>, its venue id the exchange\'s unless typed', () => {
  const seed = { options: fx('account').connectLive.options };
  const fields = set(fieldsOf('connect', seed), { connector: 'live:exchange', exchange: 'okx', venue: 'okx-main', label: 'OKX main' });
  assert.deepEqual(draftOf('connect', fields, seed, NOW),
    { type: 'connectVenue', venue: 'okx-main', connector: 'live:exchange:okx', label: 'OKX main', credentialRef: 'credentials/okx-main/api-key.json' });
  const plain = draftOf('connect', set(fields, { venue: '' }), seed, NOW);
  assert.equal(plain.venue, 'okx');
  assert.equal(plain.connector, 'live:exchange:okx');
  assert.equal(plain.credentialRef, 'credentials/okx/api-key.json');
  assert.equal(draftOf('connect', set(fields, { exchange: '' }), seed, NOW), 'Pick the exchange');
  assert.equal(draftOf('connect', set(fields, { exchange: 'coinbase' }), seed, NOW), 'Pick the exchange');
  // an option that already names its exchange signs as it is
  const named = { options: [{ connector: 'live:exchange:okx', kind: 'exchange', needs: 'key-file', label: 'OKX', defaultRef: 'credentials/<venue>/api-key.json', venues: ['okx'] }] };
  const namedFields = fieldsOf('connect', named);
  assert.ok(!namedFields.some(f => f.name === 'exchange'));
  assert.equal(draftOf('connect', set(namedFields, { connector: 'live:exchange:okx', venue: 'okx', label: 'OKX' }), named, NOW).connector, 'live:exchange:okx');
});

test('paper: a new paper account from its name and starting dollars, or a kept book continued', () => {
  const books = [{ venue: 'paper-swing', name: 'Swing · paper', cashUsd: 9000, startCashUsd: 10000, addedUsd: 0, createdAt: '', updatedAt: '', holdings: 0, positions: 0, open: 0 }];
  const seed = { books };
  const fields = fieldsOf('paper', seed);
  assert.deepEqual(fields.map(f => [f.name, f.type]), [['book', 'select'], ['label', 'text'], ['usd', 'number']]);
  assert.deepEqual(fields.find(f => f.name === 'book').options.map(o => o.value), ['', 'paper-swing']);
  assert.deepEqual(draftOf('paper', set(fields, { label: 'Momentum', usd: '25000' }), seed, NOW),
    { type: 'connectVenue', venue: 'paper-momentum', connector: 'live:paper', label: 'Momentum', credentialRef: '25000' });
  assert.deepEqual(draftOf('paper', set(fields, { book: 'paper-swing' }), seed, NOW),
    { type: 'connectVenue', venue: 'paper-swing', connector: 'live:paper', label: 'Swing · paper', credentialRef: '' });
  assert.equal(draftOf('paper', set(fields, { label: '', usd: '25000' }), seed, NOW), 'Type a name');
  assert.equal(draftOf('paper', set(fields, { label: 'Momentum', usd: '' }), seed, NOW), 'Type an amount');
});

test('paper: a new id already in use on the page or by a kept book takes -2, -3…', () => {
  const seed = { books: [{ venue: 'paper-swing', name: 'Swing · paper' }], venues: [{ id: 'paper-momentum' }, { id: 'paper-momentum-2' }] };
  const fields = fieldsOf('paper', seed);
  assert.equal(draftOf('paper', set(fields, { label: 'Momentum', usd: '1000' }), seed, NOW).venue, 'paper-momentum-3');
  assert.equal(draftOf('paper', set(fields, { label: 'Swing', usd: '1000' }), seed, NOW).venue, 'paper-swing-2');
  assert.equal(draftOf('paper', set(fields, { label: 'Value', usd: '1000' }), seed, NOW).venue, 'paper-value');
});

test('topUp and resetPaper: the paper venue and the dollars; an empty amount is what is missing', () => {
  const seed = { venue: 'paper-momentum', name: 'Momentum · paper' };
  const top = fieldsOf('topUp', seed);
  assert.deepEqual(top.map(f => [f.name, f.type]), [['usd', 'number']]);
  assert.deepEqual(draftOf('topUp', set(top, { usd: '5000' }), seed, NOW), { type: 'topUpPaper', venue: 'paper-momentum', usd: '5000' });
  assert.equal(draftOf('topUp', top, seed, NOW), 'Type an amount');
  assert.equal(typeof draftOf('topUp', set(top, { usd: 'lots' }), seed, NOW), 'string');
  const reset = fieldsOf('resetPaper', seed);
  assert.deepEqual(draftOf('resetPaper', set(reset, { usd: '10000' }), seed, NOW), { type: 'resetPaper', venue: 'paper-momentum', usd: '10000' });
  assert.equal(draftOf('resetPaper', set(reset, { usd: '' }), seed, NOW), 'Type an amount');
});

test('disconnect, declineAsk, signOut: one field each from the seed', () => {
  assert.deepEqual(draftOf('disconnect', fieldsOf('disconnect', { venue: 'ex' }), { venue: 'ex' }, NOW), { type: 'disconnectVenue', venue: 'ex' });
  assert.deepEqual(draftOf('declineAsk', [], { ask: 'ask-0001' }, NOW), { type: 'answerAsk', ask: 'ask-0001', decision: 'decline' });
  assert.deepEqual(draftOf('signOut', [], { kid: 'a5048199a8081854' }, NOW), { type: 'signOut', device: 'device:a5048199a8081854' });
  assert.equal(typeof draftOf('disconnect', [], {}, NOW), 'string');
  assert.equal(typeof draftOf('declineAsk', [], {}, NOW), 'string');
  assert.equal(typeof draftOf('signOut', [], {}, NOW), 'string');
});

test('approveCard: the card, its hash and the decision, as the page shows them', () => {
  const card = fx('account').cards[0];
  const seed = { card: card.id, hash: card.hash, decision: 'approve' };
  const draft = draftOf('approveCard', fieldsOf('approveCard', seed), seed, NOW);
  assert.deepEqual(draft, { type: 'approveCard', card: 'card-0001', action: card.hash, decision: 'approve' });
  assert.equal(draftOf('approveCard', [], { ...seed, decision: 'reject' }, NOW).decision, 'reject');
  assert.equal(typeof draftOf('approveCard', [], { ...seed, decision: 'maybe' }, NOW), 'string');
  // the Account's preparation of such a draft carries exactly its fields and the nonce
  const prepared = fx('prepared-card').action;
  assert.deepEqual(Object.keys(prepared).filter(k => k !== 'nonce').sort(), Object.keys(draft).sort());
});

test('letDevice: the signers JSON, the owners and the new device sorted without repeats, threshold 1', () => {
  const seed = { owners: ['device:ffff000011112222', { id: 'device:a5048199a8081854' }, 'device:ffff000011112222'], kid: '0123456789abcdef' };
  const draft = draftOf('letDevice', fieldsOf('letDevice', seed), seed, NOW);
  assert.deepEqual(Object.keys(draft), ['type', 'signers']);
  assert.equal(draft.type, 'convertToMultiSigUser');
  assert.equal(draft.signers, '{"authorizedUsers":["device:0123456789abcdef","device:a5048199a8081854","device:ffff000011112222"],"threshold":1}');
  // a device already among the owners is listed once
  const again = draftOf('letDevice', [], { owners: ['device:0123456789abcdef'], kid: '0123456789abcdef' }, NOW);
  assert.deepEqual(JSON.parse(again.signers), { authorizedUsers: ['device:0123456789abcdef'], threshold: 1 });
  assert.equal(typeof draftOf('letDevice', [], { owners: [] }, NOW), 'string');
  // the list replaces the owners: with none to keep it would drop every device that signs, so it is never drafted
  assert.equal(draftOf('letDevice', [], { owners: [], kid: '0123456789abcdef' }, NOW), 'No owner device to sign with');
  assert.equal(draftOf('letDevice', [], { kid: '0123456789abcdef' }, NOW), 'No owner device to sign with');
});

// plan 2 Task 13 fix round M3: the two seeds the wiring built, here beside limitSeedOf
test("letDeviceSeedOf: the page's owners and this page's own device (signing before any page names it), once each, and the waiting key", () => {
  const page = fx('account');
  assert.deepEqual(letDeviceSeedOf(page, { role: 'signs', kid: 'ded8a5bf01a7a593' }, 'feedface00000001'),
    { owners: ['device:a5048199a8081854', 'device:ded8a5bf01a7a593'], kid: 'feedface00000001' });
  const named = { ...page, signers: { ...page.signers, owners: [...page.signers.owners, { id: 'device:ded8a5bf01a7a593', kind: 'device' }] } };
  assert.deepEqual(letDeviceSeedOf(named, { kid: 'ded8a5bf01a7a593' }, 'feedface00000001').owners, ['device:a5048199a8081854', 'device:ded8a5bf01a7a593'], 'once');
  assert.deepEqual(letDeviceSeedOf(null, { kid: '' }, undefined), { owners: [], kid: '' }, 'no page and no key: nothing to keep');
  // the draft it seeds keeps every owner
  const draft = draftOf('letDevice', [], letDeviceSeedOf(page, { kid: 'ded8a5bf01a7a593' }, 'feedface00000001'), NOW);
  assert.deepEqual(JSON.parse(draft.signers).authorizedUsers, ['device:a5048199a8081854', 'device:ded8a5bf01a7a593', 'device:feedface00000001']);
});

test("paperSeedOf: the kept books read and the page's venue ids, so a new paper id is never one in use", () => {
  const page = fx('account');
  const books = { ok: true, books: [{ venue: 'paper-old', name: 'Old', cashUsd: 900 }, { name: 'no venue' }] };
  const seed = paperSeedOf(page, books);
  assert.deepEqual(seed.books.map(b => b.venue), ['paper-old']);
  assert.deepEqual(seed.venues, venuesOf(page).map(v => ({ id: v.id })));
  assert.deepEqual(paperSeedOf(null, null), { books: [], venues: [] });
  const fields = set(fieldsOf('paper', seed), { label: 'Momentum', usd: '1000' });
  assert.equal(draftOf('paper', fields, seed, NOW).venue, 'paper-momentum-2', "the page's paper-momentum in use");
});

test('grantOf: a limit or a venue asks for a limit, a knock to be let in, a top-up a top-up; the rest are the Account page\'s', () => {
  const page = fx('account');
  const [limit, venue] = page.asks;
  // the venues it trades at (an agent wallet trades nothing), and its standing trade limit
  const venues = [
    { id: 'paper', name: 'Stand-in Paper', paper: true }, { id: 'paper-momentum', name: 'Momentum · paper', paper: true },
    { id: 'broker', name: 'Stand-in Broker', paper: false }, { id: 'ex', name: 'Stand-in Exchange', paper: false },
    { id: 'wallet', name: 'Stand-in Wallet', paper: false }, { id: 'predict', name: 'Stand-in Predictions', paper: false },
  ];
  const current = { allow: ['ex', 'predict', 'wallet'], perPayment: '150', budget: '600' };
  const standing = limitSeedOf(page, AGENT, 'Claude Code');
  assert.deepEqual([standing.scope, standing.venues, standing.current], ['trade', venues, current]);
  assert.deepEqual(grantOf(limit, page), { kind: 'limit', seed: { ...standing, asked: 'ex', budget: '1000' } });
  assert.deepEqual(grantOf(venue, page), { kind: 'limit', seed: { ...standing, asked: 'standin-pubex', budget: '' } });
  const ask = over => ({ id: 'ask-0009', agent: AGENT, agentName: 'Claude Code', venue: '', usd: '', text: '', at: '', expiresAt: '', ...over });
  assert.deepEqual(grantOf(ask({ kind: 'letIn' })), { kind: 'letIn', seed: { address: AGENT, name: 'Claude Code' } });
  assert.deepEqual(grantOf(ask({ kind: 'topup', venue: 'paper-momentum', usd: '500' })), { kind: 'topUp', seed: { venue: 'paper-momentum', usd: '500' } });
  for (const kind of ['session', 'leverage', 'mode', 'memory']) assert.equal(grantOf(ask({ kind })), null, kind);
  assert.equal(grantOf(null), null);
  // a granted top-up opens with its dollars filled in
  assert.equal(valueOf(fieldsOf('topUp', grantOf(ask({ kind: 'topup', venue: 'paper-momentum', usd: '500' })).seed), 'usd'), '500');
});

test('a granted limit keeps the agent\'s standing venues and amounts, the asked venue ticked and the asked budget', () => {
  const page = fx('account');
  const [limit, venue] = page.asks;
  const { seed } = grantOf(limit, page);
  const fields = fieldsOf('limit', seed);
  assert.deepEqual(valueOf(fields, 'allow'), ['ex', 'predict', 'wallet']);
  assert.equal(valueOf(fields, 'perPayment'), '150');
  assert.equal(valueOf(fields, 'budget'), '1000');
  assert.deepEqual(draftOf('limit', fields, seed, NOW), {
    type: 'approveSpend', agent: AGENT, scope: 'trade', allow: 'ex,wallet,predict', perPayment: '150', budget: '1000', windowHours: 0, validUntil: NOW + 30 * DAY,
  });
  // a venue ask for a venue not on the page keeps the standing limit as it is
  const asked = fieldsOf('limit', grantOf(venue, page).seed);
  assert.deepEqual(valueOf(asked, 'allow'), ['ex', 'predict', 'wallet']);
  assert.equal(valueOf(asked, 'budget'), '600');
  // an asked budget under the standing per-order amount brings the per-order amount down to it
  assert.equal(valueOf(fieldsOf('limit', grantOf({ ...limit, usd: '100' }, page).seed), 'perPayment'), '100');
  // a venue asked for that is on the page is ticked beside the standing ones
  assert.deepEqual(valueOf(fieldsOf('limit', grantOf({ ...limit, venue: 'paper' }, page).seed), 'allow'), ['ex', 'predict', 'wallet', 'paper']);
});

test('limitSeedOf: the page\'s venues, paper first, and the agent\'s standing trade limit by address in any case', () => {
  const page = fx('account');
  const seed = limitSeedOf(page, AGENT.toUpperCase().replace('0X', '0x'), 'Claude Code');
  assert.deepEqual(seed.venues.slice(0, 2).map(v => v.id), ['paper', 'paper-momentum']);
  assert.deepEqual(seed.current, { allow: ['ex', 'predict', 'wallet'], perPayment: '150', budget: '600' });
  // the venues and payees rows are not the trade limit; an agent with none starts blank
  assert.equal(limitSeedOf(page, '0x1111111111111111111111111111111111111111', 'Other').current, null);
  page.spend[0].expired = true;
  assert.equal(limitSeedOf(page, AGENT, 'Claude Code').current, null);
  assert.deepEqual(limitSeedOf({ ok: false }, AGENT, 'Claude Code'), { address: AGENT, name: 'Claude Code', scope: 'trade', scopes: [], standing: {}, venues: [], current: null });
});

// the Market half's three kinds (plan 4a Task 3): the sheet view answers what host/sheet-market.js answers
test('close, amend and leverage: the sheet view delegates each to the Market half', () => {
  const close = { venue: 'ex', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', side: 'long', qty: '0.01', kind: 'perp' };
  assert.equal(titleOf('close', close), 'Close BTC perpetual');
  assert.equal(goWord('close', { ...close, kind: 'event' }), 'Sign and sell');
  assert.deepEqual(fieldsOf('close', close).map(f => [f.name, f.label, f.placeholder]), [['qty', 'How much', 'All 0.01']]);
  assert.deepEqual(draftOf('close', set(fieldsOf('close', close), { qty: '0.005' }), close, NOW), { type: 'liveClose', venue: 'ex', symbol: 'BTC/USDT:USDT', qty: '0.005' });
  const amend = { venue: 'predict', order: 'ord-0020', type: 'limit', kind: 'event', qty: '50', limitPrice: '0.6', stopPrice: '', side: 'buy', base: 'X' };
  assert.equal(titleOf('amend', amend), 'Change ord-0020');
  assert.deepEqual(fieldsOf('amend', amend).map(f => f.name), ['qty', 'limitPrice']);
  assert.deepEqual(draftOf('amend', { limitPrice: '62' }, amend, NOW), { type: 'liveAmend', venue: 'predict', order: 'ord-0020', qty: '', limitPrice: '0.62', stopPrice: '' });
  assert.equal(draftOf('amend', {}, amend, NOW), 'Type what changes');
  const lev = { venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', leverage: '3', maxLeverage: '20', marginModes: 'cross,isolated' };
  assert.equal(titleOf('leverage', lev), 'Leverage · BTC perpetual');
  assert.equal(goWord('leverage', lev), 'Sign leverage');
  assert.deepEqual(draftOf('leverage', { leverage: '5', marginMode: 'isolated' }, lev, NOW), { type: 'liveLeverage', venue: 'ex', symbol: 'BTC/USDT:USDT', leverage: '5', marginMode: 'isolated' });
  assert.equal(draftOf('leverage', { leverage: '0' }, lev, NOW), 'Leverage is a whole number, 1 or more');
  assert.equal(draftOf('leverage', { leverage: '21' }, lev, NOW), 'Leverage is at most 20x here');
  assert.equal(draftOf('leverage', { leverage: '5', marginMode: 'portfolio' }, lev, NOW), 'That margin mode is not offered here');
});
