// gravit-ui/tests/controls.test.js — the in-page controls that replaced the browser's prompt and confirm: inline editors and two-step confirms
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { seed, SEED_VERSION } from './helpers/seed.js';
import { renderDetails, renderMessagesScreen } from '../../client/js/render/messages.js';
import { renderMemory, renderSettings } from '../../client/js/render/account.js';
import { DAY } from '../../client/js/time.js';

const NOW = new Date(2026, 9, 9, 14, 7).getTime();
const fresh = () => seed(NOW);
const conv = (s, id) => s.conversations.find(c => c.id === id);

test('an inline edit starts, cancels, and commits through one reducer', () => {
  let s = R.startEdit(fresh(), { kind: 'rename', convId: 'c-1' });
  assert.deepEqual(s.edit, { kind: 'rename', convId: 'c-1' });
  assert.equal(R.cancelEdit(s).edit, null);
  const named = R.commitEdit(s, { values: { title: '  Small BTC  ' }, now: NOW });
  assert.equal(conv(named, 'c-1').title, 'Small BTC');
  assert.equal(named.edit, null);
  const blank = R.commitEdit(s, { values: { title: '  ' }, now: NOW });
  assert.equal(blank.edit.error, 'Cannot be empty');
  assert.equal(conv(blank, 'c-1').title, conv(fresh(), 'c-1').title);
  const f = fresh();
  assert.equal(R.commitEdit(f, { values: {}, now: NOW }), f, 'nothing to commit without an edit');
});

test('a memory edits in place; a blank one is refused', () => {
  const s = R.startEdit(fresh(), { kind: 'memory', id: 'mem-2' });
  assert.equal(R.commitEdit(s, { values: { text: 'No leverage, no options either' }, now: NOW }).memory.entries[1].text, 'No leverage, no options either');
  assert.equal(R.commitEdit(s, { values: { text: ' ' }, now: NOW }).edit.error, 'Cannot be empty');
});

test('a two-step confirm is asked and cancelled', () => {
  const s = R.askConfirm(fresh(), { action: 'withdraw', id: 'c-2' });
  assert.deepEqual(s.confirm, { action: 'withdraw', id: 'c-2' });
  assert.equal(R.cancelConfirm(s).confirm, null);
});

test('Mail is a screen: a letter opens by its route and is marked read; an unknown letter falls back to the inbox', async () => {
  const { renderMailScreen } = await import('../../client/js/render/mail.js');
  assert.equal(R.openMail, undefined, 'no mailbox drawer any more');
  assert.equal('open' in fresh().mail, false);
  let s = R.nav(R.toggleDetails(fresh()), { screen: 'mail', id: null });
  assert.equal(s.detailsOpen, false, 'going to Mail closes Details');
  const inbox = renderMailScreen(s, NOW);
  assert.match(inbox, /^<main class="main mail">/);
  assert.match(inbox, /<div class="mail-none">[\s\S]*?<span class="dim">No mail selected<\/span><\/div>/);
  s = R.nav(s, { screen: 'mail', id: 'mail-1' });
  assert.equal(s.mail.items[0].read, true);
  const one = renderMailScreen(s, NOW);
  assert.match(one, /^<main class="main mail has-letter">/);
  assert.match(one, /<header class="head"><h1 class="head-title">October statement<\/h1><\/header>/);
  assert.match(one, /<div class="mail-meta dim">Stand-in Broker · Today 12:07<\/div>/);
  assert.match(one, /<span class="file-chip">[\s\S]*?statement-2026-10\.pdf<\/span>/);
  assert.match(one, /<p class="mail-body">Two fills this month: NVDA \$25, KO still on the book. Holdings worth \$2,510.<\/p>/);
  assert.doesNotMatch(one, /Attachments/);
  assert.deepEqual(R.nav(fresh(), { screen: 'mail', id: 'mail-9' }).route, { screen: 'mail', id: null });
});

test('Account panels: Move shifts a holding between venues and logs it; bad moves are refused in the panel', () => {
  let s = R.openPanel(R.openSettings(R.nav(fresh(), { screen: 'account', tab: 'portfolio' })), 'move');
  assert.deepEqual([s.account.panel, s.settingsOpen], ['move', false], 'one drawer at a time');
  const moved = R.moveFunds(s, { from: 'Stand-in Wallet', to: 'Stand-in Exchange', asset: 'USDC', amount: '200', now: NOW });
  assert.equal(moved.account.panel, null);
  assert.equal(moved.account.holdings.find(h => h.name === 'USDC' && h.venue === 'Stand-in Wallet').value, 2290);
  assert.equal(moved.account.holdings.find(h => h.name === 'USDC' && h.venue === 'Stand-in Exchange').value, 200);
  assert.match(moved.account.activity[0].text, /Move \$200 USDC · Stand-in Wallet → Stand-in Exchange/);
  assert.equal(moved.account.netWorth, 12480, 'a move does not change what you own');
  const again = R.moveFunds(R.openPanel(moved, 'move'), { from: 'Stand-in Wallet', to: 'Stand-in Exchange', asset: 'USDC', amount: '10', now: NOW });
  assert.equal(again.account.holdings.find(h => h.name === 'USDC' && h.venue === 'Stand-in Exchange').value, 210, 'a second move adds to the same holding');
  const err = (from, to, asset, amount) => R.moveFunds(s, { from, to, asset, amount, now: NOW }).account.panelError;
  assert.equal(err('Stand-in Wallet', 'Stand-in Exchange', 'USDC', '0'), 'Needs a number above 0');
  assert.equal(err('Stand-in Wallet', 'Stand-in Wallet', 'USDC', '5'), 'Pick a different destination');
  assert.equal(err('Stand-in Exchange', 'Stand-in Broker', 'AAPL', '5'), 'Stand-in Exchange has no AAPL');
  assert.equal(err('Stand-in Wallet', 'Stand-in Exchange', 'USDC', '9999'), 'Stand-in Wallet only has $2,490');
});

test('Connect an account: a venue connects after a moment and joins the list; Receive copies; panels render', async () => {
  const { renderAccount } = await import('../../client/js/render/account.js');
  let s = R.openPanel(R.nav(fresh(), { screen: 'account', tab: 'venues' }), 'connect');
  s = R.connectVenue(s, 'Coinbase');
  assert.equal(s.account.connecting, 'Coinbase');
  assert.match(renderAccount(s), /Connecting…/);
  s = R.venueConnected(s, 'Coinbase');
  assert.equal(s.account.connecting, null);
  assert.deepEqual(s.account.venues.at(-1), { name: 'Coinbase', line: 'Connected · stand-in · Gravit: read only', state: 'Healthy' });
  assert.match(renderAccount(s), /data-name="Coinbase"[^>]*disabled>Connected</);
  assert.equal(R.venueConnected(s, 'Coinbase'), s, 'connecting twice is one venue');
  const p = R.nav(fresh(), { screen: 'account', tab: 'portfolio' });
  const page = renderAccount(p);
  for (const name of ['move', 'receive', 'statement']) assert.match(page, new RegExp(`data-action="openPanel" data-panel="${name}"`), name);
  assert.match(renderAccount(R.nav(fresh(), { screen: 'account', tab: 'venues' })), /data-action="openPanel" data-panel="connect"/);
  const move = renderAccount(R.openPanel(p, 'move'));
  assert.match(move, /<form class="move-form" data-action="moveFunds">/);
  for (const n of ['from', 'asset', 'to', 'amount']) assert.match(move, new RegExp(`name="${n}"`), n);
  const receive = renderAccount(R.openPanel(p, 'receive'));
  assert.match(receive, /<svg class="qr"/);
  assert.match(receive, /0x9a7c…d41e/);
  assert.match(receive, /data-action="copyAddress">Copy address</);
  assert.match(renderAccount(R.setCopied(R.openPanel(p, 'receive'), true)), />Copied</);
  const statement = renderAccount(R.openPanel(p, 'statement'));
  assert.equal((statement.match(/class="activity-row"/g) ?? []).length, 4);
  assert.match(statement, /data-action="exportStatement">Export CSV</);
});

// round-two review fixes

test('one drawer at a time: each opener closes the others, and an Account panel does not follow you off Account', () => {
  const panel = R.openPanel(R.nav(fresh(), { screen: 'account', tab: 'portfolio' }), 'receive');
  const mailed = R.nav(R.askConfirm(panel, { action: 'forgetAll' }), { screen: 'mail', id: null });
  assert.deepEqual([mailed.account.panel, mailed.confirm], [null, null], 'going to Mail closes a panel and drops a pending confirm');
  assert.equal(R.openSettings(panel).account.panel, null);
  assert.equal(R.nav(panel, { screen: 'discover', id: null }).account.panel, null, 'leaving Account closes its panel');
  assert.equal(R.nav(panel, { screen: 'account', tab: 'venues' }).account.panel, 'receive', 'moving inside Account keeps it');
});
