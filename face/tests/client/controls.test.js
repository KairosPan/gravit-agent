// The in-page controls that replaced the browser's prompt and confirm (spec 2026-10-19 §7): inline editors, two-step
// confirms, one drawer at a time — over the host-shaped states the list makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { spoken } from './helpers/spoken.js';

const conv = (id, over = {}) => ({ id, title: 'T ' + id, kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: false, archived: false, updatedAt: 1, created: null, messages: [], loaded: false, preview: null, usage: null, thinking: null, lastSeen: 0, ...over });
const fresh = () => R.nav(R.hostList(emptyState(), { conversations: [conv('c-1', { title: 'BTC under 70k' }), conv('c-2')] }), { screen: 'messages', id: 'c-1' });
const get = (s, id) => s.conversations.find(c => c.id === id);

test('an editor starts, fails with its words, and cancels', () => {
  const s = R.startEdit(fresh(), { kind: 'roster', which: 'bots', workspaceId: 'w1', choices: [], ticked: [] });
  assert.equal(s.edit.kind, 'roster');
  assert.equal(spoken(R.editFailed(s, { error: 'refused' }).edit.error), 'refused');
  assert.equal(R.cancelEdit(s).edit, null);
  const f = fresh();
  assert.equal(R.cancelEdit(f), f, 'nothing to cancel without an edit');
  assert.equal(R.commitEdit, undefined, "the rename's commit is gone with the rename (one-entry plan 2)");
  assert.equal(get(f, 'c-1').title, 'BTC under 70k');
});

test('a two-step confirm is asked and cancelled', () => {
  const s = R.askConfirm(fresh(), { action: 'deleteConv', id: 'c-2' });
  assert.deepEqual(s.confirm, { action: 'deleteConv', id: 'c-2' });
  assert.equal(R.cancelConfirm(s).confirm, null);
});

test('one drawer at a time: each opener closes the others, and the Statement does not follow you off Account', () => {
  const st = R.openStatement(R.nav(fresh(), { screen: 'account', tab: 'portfolio' }));
  assert.equal(st.account.statementOpen, true);
  const away = R.nav(R.askConfirm(st, { action: 'stopGravit', id: 'c-1' }), { screen: 'messages', id: 'c-1' });
  assert.deepEqual([away.account.statementOpen, away.confirm], [false, null], 'leaving closes the Statement and drops a pending confirm');
  assert.equal(R.openSettings(st).account.statementOpen, false);
  assert.equal(R.openStatement(R.openSettings(st)).settingsOpen, false, 'the Statement closes Settings');
  assert.equal(R.toggleDetails(st).account.statementOpen, false);
  assert.equal(R.nav(st, { screen: 'markets', id: null }).account.statementOpen, false, 'leaving Account closes it');
  assert.equal(R.nav(st, { screen: 'account', tab: 'venues' }).account.statementOpen, true, 'moving inside Account keeps it');
  const shut = R.closeStatement(st);
  assert.equal(shut.account.statementOpen, false);
  assert.equal(R.closeStatement(shut), shut, 'closing a closed Statement changes nothing');
  const set = R.openSettings(fresh());
  assert.equal(set.settingsOpen, true); assert.equal(R.closeSettings(set).settingsOpen, false);
});
