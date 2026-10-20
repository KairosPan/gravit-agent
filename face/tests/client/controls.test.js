// gravit-ui/tests/controls.test.js — the in-page controls that replaced the browser's prompt and confirm: inline editors and two-step confirms
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { seed, SEED_VERSION } from './helpers/seed.js';
import { renderDetails, renderMessagesScreen } from '../../client/js/render/messages.js';
import { renderSettings } from '../../client/js/render/account.js';
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

// round-two review fixes

test('one drawer at a time: each opener closes the others, and the Statement does not follow you off Account', () => {
  const st = R.openStatement(R.nav(fresh(), { screen: 'account', tab: 'portfolio' }));
  assert.equal(st.account.statementOpen, true);
  const mailed = R.nav(R.askConfirm(st, { action: 'stopGravit', id: 'c-1' }), { screen: 'mail', id: null });
  assert.deepEqual([mailed.account.statementOpen, mailed.confirm], [false, null], 'going to Mail closes the Statement and drops a pending confirm');
  assert.equal(R.openSettings(st).account.statementOpen, false);
  assert.equal(R.openStatement(R.openSettings(st)).settingsOpen, false, 'the Statement closes Settings');
  assert.equal(R.toggleDetails(st).account.statementOpen, false);
  assert.equal(R.nav(st, { screen: 'markets', id: null }).account.statementOpen, false, 'leaving Account closes it');
  assert.equal(R.nav(st, { screen: 'account', tab: 'venues' }).account.statementOpen, true, 'moving inside Account keeps it');
  assert.equal(R.closeStatement(st).account.statementOpen, false);
  const shut = R.closeStatement(st);
  assert.equal(R.closeStatement(shut), shut, 'closing a closed Statement changes nothing');
});
