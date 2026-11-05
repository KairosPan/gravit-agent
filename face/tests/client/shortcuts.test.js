// The shortcut sheet (spec 2026-11-03 §5.12): the bound rows of keys.js by section, each its action's words and the
// platform's chord; a query keeps the rows whose words or chord hold it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShortcuts } from '../../client/js/render/shortcuts.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { closeOverlays } from '../../client/js/reducers/messages.js';
import { emptyState } from '../../client/js/data/empty.js';
import { SHORTCUTS } from '../../client/js/keys.js';

const open = (q = '') => R.setShortcutsQuery(R.openShortcuts(emptyState()), q);
const rows = html => [...html.matchAll(/<li class="sc-row"><span class="sc-what">([^<]*)<\/span><kbd class="sc-key">([^<]*)<\/kbd><\/li>/g)].map(m => [m[1], m[2]]);

test("the sheet lists the bound rows of each section with the platform's chords", () => {
  const mac = renderShortcuts(open(), { mac: true });
  assert.match(mac, /^<div class="scrim" data-action="closeShortcuts"><\/div><section class="shortcuts" role="dialog" aria-modal="true" aria-labelledby="sc-title">/);
  assert.match(mac, /<h2 id="sc-title">Keyboard shortcuts<\/h2><button type="button" id="sc-close" class="close-key" data-action="closeShortcuts" aria-label="Close">/);
  assert.match(mac, /<input id="sc-q" class="input" type="search" value="" placeholder="Search shortcuts" aria-label="Search shortcuts" autocomplete="off" spellcheck="false" data-action="scQuery">/);
  assert.match(mac, /<h3 class="sc-section">General<\/h3>[\s\S]*<h3 class="sc-section">Composer<\/h3>/);
  assert.deepEqual(rows(mac), [['New conversation', '⌥⌘N'], ['Search conversations', '⌥⌘K'], ['Settings', '⌥⌘,'], ['This sheet', '⌘/'],
    ['Send', 'Enter'], ['New line', '⇧Enter'], ['Commands and skills', '/'], ['Files, conversations, bots', '@'], ['Close a menu, sheet or drawer', 'Esc']]);
  assert.match(mac, /<p class="sc-note">⌘ is Ctrl off a Mac. Keys follow dsh's web bindings.<\/p><\/section>$/);
  const pc = renderShortcuts(open(), { mac: false });
  assert.deepEqual(rows(pc).slice(0, 6).map(r => r[1]), ['Ctrl+Alt+N', 'Ctrl+Alt+K', 'Ctrl+Alt+,', 'Ctrl+/', 'Enter', 'Shift+Enter']);
});

test('an unbound row is not listed', () => {
  const table = SHORTCUTS.map(r => (r.id === 'settings' || r.id === 'send' ? { ...r, bound: false } : r));
  const html = renderShortcuts(open(), { mac: true, table });
  assert.deepEqual(rows(html).map(r => r[0]), ['New conversation', 'Search conversations', 'This sheet', 'New line', 'Commands and skills', 'Files, conversations, bots', 'Close a menu, sheet or drawer']);
});

test('a query keeps the matching rows, any case, and none left says No shortcut matches', () => {
  assert.deepEqual(rows(renderShortcuts(open('CONVERSATION'), { mac: true })).map(r => r[0]), ['New conversation', 'Search conversations', 'Files, conversations, bots']);
  // a chord holds it too, on the platform's names; a section left empty draws no heading
  const ctrl = renderShortcuts(open('ctrl+alt'), { mac: false });
  assert.deepEqual(rows(ctrl).map(r => r[1]), ['Ctrl+Alt+N', 'Ctrl+Alt+K', 'Ctrl+Alt+,']);
  assert.doesNotMatch(ctrl, /Composer/);
  assert.deepEqual(rows(renderShortcuts(open('ctrl'), { mac: true })), [], 'the Mac names hold no Ctrl');
  const none = renderShortcuts(open('zzz'), { mac: true });
  assert.match(none, /<p class="sc-none">No shortcut matches<\/p>/);
  assert.doesNotMatch(none, /sc-section/);
  assert.doesNotMatch(renderShortcuts(open(), { mac: true }), /No shortcut matches/);
});

test('the query is escaped', () => {
  const html = renderShortcuts(open('"><img src=x>'), { mac: true });
  assert.match(html, /value="&quot;&gt;&lt;img src=x&gt;"/);
  assert.doesNotMatch(html, /<img/);
});

test('nothing is drawn while closed', () => {
  assert.equal(renderShortcuts(emptyState(), { mac: true }), '');
  assert.equal(renderShortcuts(R.closeShortcuts(open('x')), { mac: true }), '');
});

test('the slice: opened with an empty query, the query set only while open, kept a string', () => {
  assert.deepEqual(R.openShortcuts(emptyState()).shortcuts, { q: '' });
  assert.equal(R.setShortcutsQuery(emptyState(), 'x').shortcuts, null, 'no sheet, no query');
  assert.deepEqual(open('Send').shortcuts, { q: 'Send' });
  assert.deepEqual(R.setShortcutsQuery(R.openShortcuts(emptyState()), 7).shortcuts, { q: '' });
  const s = open('x');
  assert.equal(R.openShortcuts(s), s, 'open again keeps the query');
});

test('a move to another screen, or an opener that closes the overlays, closes the sheet as it does the lightbox', () => {
  assert.equal(R.nav(open('x'), { screen: 'markets', id: null }).shortcuts, null);
  assert.equal(closeOverlays(open('x')).shortcuts, null);
});
